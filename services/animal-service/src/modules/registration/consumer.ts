import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
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
    const feeMinor = calculateRegistrationFee(p.animalType);
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Sequence number reserved inside this transaction (see
      // repo.nextRegistrationNumber) -- replaces the old
      // `Date.now() % 999999` scheme; see complaints/consumer.ts for the
      // full rationale (identical bug, identical fix).
      const registrationNumber = generateRegistrationNumber("ULB", await repo.nextRegistrationNumber(tx));
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
      // Fee is assessed the moment the registration is created (feeMinor is
      // derived server-side from a fixed, animal-type-keyed schedule --
      // domain.ts's calculateRegistrationFee -- never from a client-supplied
      // amount; see cross-events.ts's MAX_FEE_CHALLAN_AMOUNT_MINOR comment
      // for the full reasoning), so the challan is raised atomically with
      // the row that assesses it. emitMunicipalFeeChallan no-ops for
      // amountMinor <= 0n (never the case here -- every branch of
      // calculateRegistrationFee returns a positive amount).
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: registrationNumber,
        depositor: p.ownerName,
        amountMinor: feeMinor,
      });
      await enqueue(tx, {
        topic: EVENTS.animalRegistered,
        eventType: EVENTS.animalRegistered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { registrationId: p.id, registrationNumber, animalType: p.animalType },
      });
      // Citizen-meaningful: acknowledgement that the registration was
      // created, with the reference number the owner will need for renewal/
      // transfer and the fee they now owe. There is no dedicated
      // "registration submitted" template (this service has no
      // draft/submit workflow -- registerAnimal goes straight to "active",
      // see domain.ts's REGISTRATION_STATUSES), so this reuses
      // MUNICIPAL_EVENT_TYPES.applicationSubmitted as the "request
      // received" acknowledgement, the same reuse sewerage-service applied
      // to its own complaintCreate for the identical reason.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: p.ownerName,
        recipientId: msg.actorId,
        variables: { registrationId: p.id, registrationNumber, animalType: p.animalType, feeMinor: String(feeMinor) },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.create",
        resourceType: "animal_registration",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "animal registered");
  });

  queue.subscribe(COMMANDS.renewRegistration, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    // Recipient-lookup read BEFORE opening the write transaction -- this
    // command's payload carries only {id, tenantId}, so the owner's name
    // and the registration's own reference number have to be fetched from
    // the current row. Doing this via a plain repo.findById (its own,
    // already-committed read transaction) rather than a query nested
    // inside the write transaction below is the fix for PR #1028's
    // connection-pool deadlock class -- see connections/consumer.ts's
    // connectionUpdateStatus (sewerage-service) for the full rationale.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Matches routes.ts's /renew pre-check: renewal is valid from either
      // "active" (early renewal) or "expired" (lapsed renewal).
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "active", msg.actorId, ["active", "expired"]);
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
      // Citizen-meaningful: the registration (possibly lapsed) is active
      // again -- this service's renewRegistration recomputes no fee (see
      // domain.ts: calculateRegistrationFee is only ever called from
      // registerAnimal), so this is a status-only confirmation, not a fee
      // challan; inventing a renewal fee here would be scope creep beyond
      // what this domain actually implements.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.ownerName,
          recipientId: existing.createdBy,
          variables: { registrationId: p.id, registrationNumber: existing.registrationNumber, status: "active" },
        });
      }
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
    // Recipient-lookup read BEFORE opening the write transaction (same
    // PR #1028 rationale as renewRegistration above) -- fetched here for
    // the registration's own reference number; the recipient's name/phone
    // for a transfer come from the command payload itself (the new owner),
    // not from the pre-transfer row.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Matches routes.ts's /transfer pre-check: transfer is valid from "active" only.
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "transferred", msg.actorId, ["active"]);
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
      // Citizen-meaningful: the NEW owner is now the party of record for
      // this registration, so they (not the previous owner, who already
      // knew they were transferring it away) are the notification
      // recipient. No recipientId is set: unlike ownerName/ownerPhone,
      // there is no citizen account uuid for the incoming owner anywhere
      // in this payload or on the pre-transfer row.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: p.newOwnerName,
        variables: {
          registrationId: p.id,
          registrationNumber: existing?.registrationNumber ?? "",
          status: "transferred",
        },
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
