import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
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
    let registrationNumber = "";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // `Date.now() % 999999` (periodic on ~16.7 minutes -- a real collision
      // under load against a UNIQUE-constrained column) replaced with a real
      // Postgres SEQUENCE reserved inside this same transaction. See
      // repo.ts's nextRegistrationNumber and migrations/
      // 0002_number_sequences.sql for the full rationale.
      registrationNumber = generateRegistrationNumber("ULB", await repo.nextRegistrationNumber(tx));
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
    // Read outside the transaction (mirrors building-service's/shop-service's
    // Wave 3 pattern): repo.findById opens its own scopedRead transaction,
    // so calling it from inside db.transaction below would nest transactions
    // on the same pool -- the exact bug class that deadlocked notification-
    // service's deliveries/consumer.ts under concurrent load. citizen-facing:
    // the vendor's submission was received -- worth a confirmation.
    const reg = await repo.findById(p.id, msg.tenantId);
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
      if (reg) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
          recipient: reg.vendorName,
          recipientId: p.id,
          variables: { registrationId: p.id, registrationNumber: reg.registrationNumber },
        });
      }
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
    // citizen-facing: withdrawal is self-initiated by the vendor, but it is
    // still a terminal state change on their own application (draft/
    // submitted -> withdrawn per domain.ts's VALID_TRANSITIONS) that closes
    // the loop the same way a rejection would -- worth a confirmation record,
    // not an "internal" step. Read before the transaction for the same
    // nested-transaction reason as submitRegistration above.
    const reg = await repo.findById(p.id, msg.tenantId);
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
      if (reg) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: reg.vendorName,
          recipientId: p.id,
          variables: { registrationId: p.id, registrationNumber: reg.registrationNumber, status: "withdrawn" },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "registration.withdraw",
        resourceType: "vendor_registration",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "registration", p.id));
  });
}
