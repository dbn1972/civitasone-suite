import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, generateRegistrationNumber } from "./domain.js";

const log = pino({ name: "vendor.registrations.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRegistrationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createRegistration, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      vendorName: string;
      vendorAadhaar: string;
      vendorPhone: string;
      vendorPhoto?: string;
      category: string;
      preferredZone?: string;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const feeMinor = calculateFeeMinor({ category: p.category });
    const registrationNumber = generateRegistrationNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRegistration(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        registrationNumber,
        status: "draft",
        vendorName: p.vendorName,
        vendorAadhaar: p.vendorAadhaar,
        vendorPhone: p.vendorPhone,
        vendorPhoto: p.vendorPhoto ?? null,
        category: p.category,
        preferredZone: p.preferredZone ?? null,
        allocatedZone: null,
        allocatedSpot: null,
        documents: p.documents ?? [],
        feeMinor,
        feeCurrency: "INR",
        feePaid: false,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.registrationCreated,
        eventType: EVENTS.registrationCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          registrationId: p.id,
          registrationNumber,
          vendorName: p.vendorName,
          feeMinor: String(feeMinor),
          feeCurrency: "INR",
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.create",
        resourceType: "vendor_registration",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, registrationNumber }, "vendor registration created");
  });

  queue.subscribe(COMMANDS.submitRegistration, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "submitted", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.registrationSubmitted,
        eventType: EVENTS.registrationSubmitted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.submit",
        resourceType: "vendor_registration",
        resourceId: p.id,
      });
    });
    // GET /v1/vendor/registrations/:id (registrations/routes.ts) reads
    // through a cache that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.id));
  });

  queue.subscribe(COMMANDS.withdrawRegistration, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "withdrawn", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.registrationWithdrawn,
        eventType: EVENTS.registrationWithdrawn,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.withdraw",
        resourceType: "vendor_registration",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.id));
  });
}
