import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import {
  emitMunicipalNotification,
  municipalDecisionNotificationEventType,
  MUNICIPAL_EVENT_TYPES,
} from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as licenceRepo from "../licences/repo.js";
import * as regRepo from "../registrations/repo.js";
import { calculateRenewalFeeMinor } from "./domain.js";

/**
 * Resolves the vendor's own name for notification recipient/depositor,
 * tracing licence -> registration the same way licences/consumer.ts does
 * (a licence row carries no vendor identity of its own). Both reads use
 * scopedRead internally and must happen outside any open db.transaction
 * (nested-transaction deadlock risk — see licences/consumer.ts's issueLicence
 * for the full explanation).
 */
async function resolveVendorName(licenceId: string, tenantId: string): Promise<string | null> {
  const licence = await licenceRepo.findById(licenceId, tenantId);
  if (!licence) return null;
  const reg = await regRepo.findById(licence.registrationId, tenantId);
  return reg?.vendorName ?? null;
}

const log = pino({ name: "vendor.lifecycle.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLifecycleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.requestRenewal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; licenceId: string; renewalType: string };
    const feeMinor = calculateRenewalFeeMinor(p.renewalType);
    // Note: this fee (Rs 750 for "renewal") is computed and persisted on the
    // vendor_renewals row same as before, but is NOT raised as a
    // finance.challan.create here — vendor-service has no fee-payment
    // idempotency-guarded route for renewal fees (only licences/routes.ts's
    // fee-payment route, PR #1009, guards vendor_licences.feePaid). Per this
    // wave's scope (fee challan wired at licence issuance only), raising a
    // challan here with no corresponding payment-confirmation flow to mark
    // it settled would be new functionality, not wiring — flagged in the PR
    // description as a follow-up, not fixed in this PR.
    const vendorName = await resolveVendorName(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRenewal(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        licenceId: p.licenceId,
        renewalType: p.renewalType,
        status: "submitted",
        feeMinor,
        feeCurrency: "INR",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.renewalRequested,
        eventType: EVENTS.renewalRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, licenceId: p.licenceId, renewalType: p.renewalType },
      });
      if (vendorName) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: vendorName,
          recipientId: p.id,
          variables: { requestId: p.id, licenceId: p.licenceId, renewalType: p.renewalType, status: "submitted" },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.renewal",
        resourceType: "vendor_renewal",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, licenceId: p.licenceId }, "renewal requested");
  });

  queue.subscribe(COMMANDS.requestZoneTransfer, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      licenceId: string;
      renewalType: string;
      newZone: string;
      newSpot: string;
    };
    const feeMinor = calculateRenewalFeeMinor(p.renewalType);
    const vendorName = await resolveVendorName(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRenewal(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        licenceId: p.licenceId,
        renewalType: p.renewalType,
        status: "submitted",
        feeMinor,
        feeCurrency: "INR",
        details: { newZone: p.newZone, newSpot: p.newSpot },
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.zoneTransferRequested,
        eventType: EVENTS.zoneTransferRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, licenceId: p.licenceId, newZone: p.newZone, newSpot: p.newSpot },
      });
      if (vendorName) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: vendorName,
          recipientId: p.id,
          variables: { requestId: p.id, licenceId: p.licenceId, renewalType: p.renewalType, status: "submitted" },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.zone_transfer",
        resourceType: "vendor_renewal",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, licenceId: p.licenceId }, "zone transfer requested");
  });

  queue.subscribe(COMMANDS.requestCancellation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; licenceId: string; renewalType: string; reason: string };
    const vendorName = await resolveVendorName(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRenewal(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        licenceId: p.licenceId,
        renewalType: p.renewalType,
        status: "submitted",
        feeMinor: 0n,
        feeCurrency: "INR",
        details: { reason: p.reason },
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.cancellationRequested,
        eventType: EVENTS.cancellationRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, licenceId: p.licenceId, reason: p.reason },
      });
      if (vendorName) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: vendorName,
          recipientId: p.id,
          variables: { requestId: p.id, licenceId: p.licenceId, renewalType: p.renewalType, status: "submitted" },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.cancellation",
        resourceType: "vendor_renewal",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.requestSurrender, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; licenceId: string; renewalType: string; reason: string };
    const vendorName = await resolveVendorName(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRenewal(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        licenceId: p.licenceId,
        renewalType: p.renewalType,
        status: "submitted",
        feeMinor: 0n,
        feeCurrency: "INR",
        details: { reason: p.reason },
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.surrenderRequested,
        eventType: EVENTS.surrenderRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, licenceId: p.licenceId, reason: p.reason },
      });
      if (vendorName) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: vendorName,
          recipientId: p.id,
          variables: { requestId: p.id, licenceId: p.licenceId, renewalType: p.renewalType, status: "submitted" },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.surrender",
        resourceType: "vendor_renewal",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.decideLifecycleRequest, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      decision: string;
      reason?: string;
      newValidUntil?: string;
    };
    // citizen-facing regardless of renewalType or outcome: a decision on
    // any of the 4 request types (renewal/zone_transfer/cancellation/
    // surrender) is the moment the vendor learns whether their request was
    // accepted -- mirrors trade-service's decideRenewal, which notifies
    // approved, rejected, AND surrender (all three, not just the successful
    // path). Read the renewal row (for licenceId -> vendorName) before the
    // transaction, same no-nested-transaction reason as elsewhere in this
    // service.
    const renewal = await repo.findById(p.id, msg.tenantId);
    const vendorName = renewal ? await resolveVendorName(renewal.licenceId, msg.tenantId) : null;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const newValid = p.newValidUntil ? new Date(p.newValidUntil) : null;
      // updateDecision's boolean return (renewal request actually matched
      // tenant+id) was previously discarded, so a stale/mismatched decide
      // command still published lifecycleRequestDecided and wrote an audit
      // record for a decision that was never actually recorded.
      //
      // NOTE (flagged, not fixed here — see PR description): even when this
      // succeeds, nothing anywhere in vendor-service consumes
      // EVENTS.lifecycleRequestDecided, so approving a renewal/zone-transfer
      // /cancellation/surrender request updates ONLY this vendor_renewals
      // row — it never touches the actual vendor_licences record (no
      // validUntil extension, no zone/spotNumber change, no cancelled/
      // surrendered status). That is a real, separate functional gap
      // spanning all 4 renewal types, not a one-line fix like the
      // discarded-boolean pattern fixed elsewhere in this PR.
      const ok = await repo.updateDecision(tx, p.id, msg.tenantId, p.decision, msg.actorId, p.reason ?? null, newValid);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.lifecycleRequestDecided,
        eventType: EVENTS.lifecycleRequestDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, decision: p.decision, reason: p.reason },
      });
      if (renewal && vendorName) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(MUNICIPAL_EVENT_TYPES.statusChanged, p.decision),
          recipient: vendorName,
          recipientId: p.id,
          variables: {
            requestId: p.id,
            licenceId: renewal.licenceId,
            renewalType: renewal.renewalType,
            decision: p.decision,
          },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: `lifecycle.${p.decision}`,
        resourceType: "vendor_renewal",
        resourceId: p.id,
      });
    });
    if (applied) log.info({ id: p.id, decision: p.decision }, "lifecycle request decided");
  });
}
