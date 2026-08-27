import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateRegistrationNumber, calculateRegistrationFee } from "./domain.js";

const log = pino({ name: "animal.registration.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRegistrationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.registerAnimal, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      ownerName: string;
      ownerPhone: string;
      ownerAddress: Record<string, unknown>;
      animalType: string;
      breed?: string;
      name?: string;
      color?: string;
      age?: number;
      sex?: string;
      microchipId?: string;
      vaccinationRecords?: Array<{ vaccine: string; date: string; nextDue?: string; vet?: string }>;
      photo?: string;
    };
    const registrationNumber = generateRegistrationNumber("ULB", Date.now() % 999999);
    const feeMinor = calculateRegistrationFee(p.animalType);
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRegistration(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        registrationNumber,
        ownerName: p.ownerName,
        ownerPhone: p.ownerPhone,
        ownerAddress: p.ownerAddress as never,
        animalType: p.animalType,
        breed: p.breed ?? null,
        name: p.name ?? null,
        color: p.color ?? null,
        age: p.age ?? null,
        sex: p.sex ?? null,
        microchipId: p.microchipId ?? null,
        vaccinationRecords: p.vaccinationRecords ?? null,
        photo: p.photo ?? null,
        status: "active",
        validUntil: validUntil.toISOString().slice(0, 10),
        feeMinor,
        currency: "INR",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.animalRegistered,
        eventType: EVENTS.animalRegistered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.id, registrationNumber, animalType: p.animalType },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.create",
        resourceType: "animal_registration",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, registrationNumber }, "animal registered");
  });

  queue.subscribe(COMMANDS.renewRegistration, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "active", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.registrationRenewed,
        eventType: EVENTS.registrationRenewed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.renew",
        resourceType: "animal_registration",
        resourceId: p.id,
      });
    });
    // GET /v1/animal/registrations/:id (registration/routes.ts) serves through
    // a read-through cache that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.id));
  });

  queue.subscribe(COMMANDS.transferRegistration, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; newOwnerName: string; newOwnerPhone: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "transferred", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.registrationTransferred,
        eventType: EVENTS.registrationTransferred,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.id, newOwnerName: p.newOwnerName },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.transfer",
        resourceType: "animal_registration",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.id));
  });
}
