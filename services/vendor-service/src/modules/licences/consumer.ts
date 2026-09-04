import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import {
  emitMunicipalFeeChallan,
  emitMunicipalNotification,
  municipalDecisionNotificationEventType,
  MUNICIPAL_EVENT_TYPES,
} from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as regRepo from "../registrations/repo.js";
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

    // Fee challan: licence issuance, not registration creation, is where
    // the fee actually becomes due here. registrations/domain.ts's
    // calculateFeeMinor runs at createRegistration and the amount is
    // stored on the registration row, but vendor_registrations.feePaid is
    // never referenced by any consumer -- the ONLY payment path this
    // service actually enforces is licences/routes.ts's fee-payment route
    // (existing.feePaid -> 409, PR #1009), which guards vendor_licences,
    // not vendor_registrations. So the challan the vendor must actually pay
    // against is raised here, at the moment a licence (and therefore a real
    // payable obligation on vendor_licences) comes into existence.
    //
    // Read before the transaction, not inside it: regRepo.findById opens
    // its own scopedRead transaction, so calling it inside db.transaction
    // below would nest transactions on the same pool -- the deadlock class
    // fixed tonight in notification-service's deliveries/consumer.ts.
    const reg = await regRepo.findById(p.registrationId, msg.tenantId);

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
      if (reg) {
        // feeMinor is nullable in the schema (bigint column, no NOT NULL);
        // emitMunicipalFeeChallan's own <= 0n guard also no-ops a null/zero
        // fee, but the ?? 0n keeps the bigint arithmetic type-safe either way.
        await emitMunicipalFeeChallan(tx, ctxOf(msg), {
          sourceRef: p.id,
          depositor: reg.vendorName,
          amountMinor: reg.feeMinor ?? 0n,
          currency: reg.feeCurrency,
        });
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.permitIssued,
          recipient: reg.vendorName,
          recipientId: p.id,
          variables: { licenceId: p.id, licenceNumber, zone: p.zone, spotNumber: p.spotNumber },
        });
        // Mirrors building-service's applications/consumer.ts: the challan
        // and the citizen-facing "a fee is now due" notification are raised
        // together, in the same transaction, at the same trigger point.
        if ((reg.feeMinor ?? 0n) > 0n) {
          await emitMunicipalNotification(tx, ctxOf(msg), {
            eventType: MUNICIPAL_EVENT_TYPES.feeDue,
            recipient: reg.vendorName,
            recipientId: p.id,
            variables: { licenceId: p.id, amountMinor: String(reg.feeMinor ?? 0n), currency: reg.feeCurrency },
          });
        }
      }
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
    // Two-hop read (licence -> registration -> vendorName), same shape as
    // building-service's permit -> application -> createdBy chain: the
    // licence row itself carries no vendor identity, only registrationId.
    // Both reads happen before the transaction for the same
    // no-nested-transaction reason noted in issueLicence above.
    const licence = await repo.findById(p.id, msg.tenantId);
    const reg = licence ? await regRepo.findById(licence.registrationId, msg.tenantId) : null;
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
      if (reg) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: reg.vendorName,
          recipientId: p.id,
          variables: { licenceId: p.id, status: "suspended", reason: p.reason },
        });
      }
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
    const licence = await repo.findById(p.id, msg.tenantId);
    const reg = licence ? await regRepo.findById(licence.registrationId, msg.tenantId) : null;
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
      if (reg) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: reg.vendorName,
          recipientId: p.id,
          variables: { licenceId: p.id, status: "cancelled", reason: p.reason },
        });
      }
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
    // citizen-facing: a payment receipt confirmation is at least as
    // citizen-meaningful as the other status transitions wired in this
    // file -- arguably more so, since it's the vendor's proof of payment.
    const licence = await repo.findById(p.id, msg.tenantId);
    const reg = licence ? await regRepo.findById(licence.registrationId, msg.tenantId) : null;
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
      if (reg) {
        // No dedicated "fee received" template exists in MUNICIPAL_EVENT_TYPES
        // (feeDue is specifically for the challan-raised moment, already used
        // in issueLicence above) -- statusChanged is the correct generic fit
        // for a payment-received confirmation.
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: reg.vendorName,
          recipientId: p.id,
          variables: { licenceId: p.id, status: "fee_paid", transactionId: p.transactionId },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "licence.record_fee",
        resourceType: "vendor_licence",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "licence", p.id));
  });
}
