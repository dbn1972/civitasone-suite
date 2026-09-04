import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateLicenceNumber, generateVerificationCode } from "./domain.js";

const log = pino({ name: "vendor.licences.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLicenceConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueLicence, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      registrationId: string;
      zone: string;
      spotNumber: string;
      validFrom: string;
      validUntil: string;
    };
    const verificationCode = generateVerificationCode();
    let licenceNumber = "";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // `Date.now() % 999999` (periodic on ~16.7 minutes) replaced with a
      // real Postgres SEQUENCE reserved inside this same transaction — see
      // repo.ts's nextLicenceNumber for the full rationale.
      licenceNumber = generateLicenceNumber("ULB", await repo.nextLicenceNumber(tx));
      await repo.insertLicence(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        licenceNumber,
        registrationId: p.registrationId,
        status: "active",
        issuedAt: new Date(),
        validFrom: new Date(p.validFrom),
        validUntil: new Date(p.validUntil),
        zone: p.zone,
        spotNumber: p.spotNumber,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.licenceIssued,
        eventType: EVENTS.licenceIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          licenceId: p.id,
          licenceNumber,
          registrationId: p.registrationId,
          zone: p.zone,
          spotNumber: p.spotNumber,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.issue",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, licenceNumber }, "vendor licence issued");
  });

  queue.subscribe(COMMANDS.suspendLicence, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "suspended", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.licenceSuspended,
        eventType: EVENTS.licenceSuspended,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { licenceId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.suspend",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
    // GET /v1/vendor/licences/:id (licences/routes.ts) reads through a cache
    // that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "licence", p.id));
  });

  queue.subscribe(COMMANDS.cancelLicence, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.licenceCancelled,
        eventType: EVENTS.licenceCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { licenceId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.cancel",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "licence", p.id));
  });

  queue.subscribe(COMMANDS.recordLicenceFee, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; transactionId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Previously this handler persisted NOTHING — it only published an
      // event and wrote an audit row, for a table (vendor_licences) that
      // had no fee_paid column to update in the first place. See
      // migrations/0003_licence_fee_paid.sql + routes.ts's fee-payment
      // idempotency guard (existing.feePaid -> 409), which depends on this
      // actually persisting.
      const ok = await repo.updateFeePayment(tx, p.id, msg.tenantId, p.transactionId, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.licenceFeeRecorded,
        eventType: EVENTS.licenceFeeRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { licenceId: p.id, transactionId: p.transactionId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.record_fee",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "licence", p.id));
  });
}
