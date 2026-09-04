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
import * as appRepo from "../applications/repo.js";
import type { AdvApplicationRow } from "../applications/schema.js";
import { generatePermitNumber, generateVerificationCode } from "./domain.js";

const log = pino({ name: "advertisement.permits.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

/**
 * suspend/cancel/renew commands only carry permitId — resolve the
 * originating application via the permit row (a citizen-meaningful
 * notification/challan needs its advertiser identity). Mirrors
 * trade-service's findApplicationForLicence (PR #1022) and shop-service's
 * equivalent lookup in lifecycle/consumer.ts (PR #1021).
 */
async function findApplicationForPermit(permitId: string, tenantId: string): Promise<AdvApplicationRow | null> {
  const permit = await repo.findById(permitId, tenantId);
  if (!permit) return null;
  return appRepo.findById(permit.applicationId, tenantId);
}

export function registerPermitConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issuePermit, async (msg) => {
    const p = msg.payload as {
      id: string;
      applicationId: string;
      validFrom: string;
      validUntil: string;
      location: Record<string, unknown>;
      advertisementType: string;
    };
    const now = new Date();
    let permitNumber = "";
    // Looked up here, not inside the transaction, purely to resolve the
    // applicant's identity for the citizen notification below — the permit
    // row itself carries no advertiser reference, only application_id. See
    // the deadlock-avoidance note on submitApplication in
    // applications/consumer.ts (PR #1028) for why this must not be nested
    // inside db.transaction below.
    const application = await appRepo.findById(p.applicationId, msg.tenantId);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // BUG FIX (collision-prone number generation): see
      // applications/repo.ts's nextApplicationNumberSeq for the full
      // rationale — same fix, same shape, for permit_number.
      const seq = await repo.nextPermitNumberSeq(tx);
      permitNumber = generatePermitNumber("ULB", seq);
      const verificationCode = generateVerificationCode();
      await repo.insertPermit(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        permitNumber,
        status: "active",
        issuedAt: now,
        validFrom: p.validFrom,
        validUntil: p.validUntil,
        location: p.location as never,
        advertisementType: p.advertisementType,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitIssued,
        eventType: EVENTS.permitIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.id, permitNumber, applicationId: p.applicationId, verificationCode },
      });
      // Cross-service wiring: permit issuance is a citizen-meaningful
      // transition. No fee is raised here — the advertisement fee is
      // assessed and challaned when the application is submitted (see
      // applications/consumer.ts's submitApplication).
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.permitIssued,
        recipient: application?.advertiserName ?? "Permit holder",
        recipientId: application?.createdBy ?? msg.actorId,
        variables: { permitId: p.id, permitNumber, applicationId: p.applicationId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "permit.issue", resourceType: "adv_permit", resourceId: p.id });
    });
    log.info({ id: p.id, permitNumber }, "advertisement permit issued");
  });

  queue.subscribe(COMMANDS.renewPermit, async (msg) => {
    const p = msg.payload as { id: string; permitId: string; renewalType: string; newValidUntil: string; feeMinor: string };
    const permit = await repo.findById(p.permitId, msg.tenantId);
    // Resolved here (not inside the transaction) purely for the fee-challan
    // depositor and the citizen notification below — the renewal fee
    // genuinely becomes payable at the moment this command applies (unlike
    // application creation, a renewal has no separate "draft" stage; see
    // applications/consumer.ts's submitApplication for the fuller version of
    // this reasoning).
    const application = permit ? await appRepo.findById(permit.applicationId, msg.tenantId) : null;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Previously this handler unconditionally inserted an "approved"
      // renewal record carrying the new expiry date but NEVER wrote that
      // date back onto the permit's own `validUntil` column — GET
      // /v1/advertisement/permits/:id and the public /verify endpoint kept
      // showing the OLD validUntil (and would eventually show the permit as
      // expired to an inspector) even after a genuine renewal. Extend the
      // permit first; its boolean return also now guards against creating a
      // renewal record for a permit that no longer exists / wrong tenant
      // (previously silently used `permit?.validUntil ?? null` and proceeded
      // regardless).
      const ok = await repo.updateValidUntil(tx, p.permitId, msg.tenantId, p.newValidUntil, msg.actorId);
      if (!ok) return;
      applied = true;
      // BUG FIX (money field): p.feeMinor is now validated + normalized to
      // a canonical base-10 digit string by zMoneyMinorStringNonNeg at the
      // route (permits/routes.ts renewBody) before the command is ever
      // published, so BigInt() here can no longer throw on malformed input
      // inside the write transaction (previously a bare z.string() let any
      // non-numeric string reach this BigInt() call post-202).
      const feeMinor = BigInt(p.feeMinor);
      await repo.insertRenewal(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        renewalType: p.renewalType,
        status: "approved",
        feeMinor,
        currency: "INR",
        previousValidUntil: permit?.validUntil ?? null,
        newValidUntil: p.newValidUntil,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitRenewed,
        eventType: EVENTS.permitRenewed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { renewalId: p.id, permitId: p.permitId, newValidUntil: p.newValidUntil },
      });
      // Cross-service wiring: the renewal fee is genuinely due now — raise
      // the challan atomically with the renewal record and the validUntil
      // extension. emitMunicipalFeeChallan no-ops for amountMinor <= 0n.
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: p.id,
        depositor: application?.advertiserName ?? p.permitId,
        amountMinor: feeMinor,
      });
      // Citizen-meaningful transition: the permit was renewed and is valid
      // for longer. No more specific MUNICIPAL_EVENT_TYPES entry exists for
      // "renewed" (mirrors trade-service's decideRenewal, PR #1022, using
      // statusChanged for the same reason).
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: application?.advertiserName ?? "Permit holder",
        recipientId: application?.createdBy ?? msg.actorId,
        variables: { permitId: p.permitId, renewalId: p.id, status: "renewed", newValidUntil: p.newValidUntil },
      });
      await writeAudit(tx, ctxOf(msg), { action: "permit.renew", resourceType: "adv_permit", resourceId: p.permitId });
    });
    // GET /v1/advertisement/permits/:id (permits/routes.ts) reads through a
    // cache that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.permitId));
  });

  queue.subscribe(COMMANDS.suspendPermit, async (msg) => {
    const p = msg.payload as { id: string; reason: string };
    // Wave 3 cross-service wiring: suspension is citizen-meaningful (their
    // permit stops being valid) — resolve the advertiser before the tx.
    const application = await findApplicationForPermit(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "suspended", msg.actorId, {
        suspendedAt: new Date(),
        suspensionReason: p.reason,
      });
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.permitSuspended, eventType: EVENTS.permitSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.id, reason: p.reason } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: application?.advertiserName ?? "Permit holder",
        recipientId: application?.createdBy ?? msg.actorId,
        variables: { permitId: p.id, status: "suspended", reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), { action: "permit.suspend", resourceType: "adv_permit", resourceId: p.id });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.id));
  });

  queue.subscribe(COMMANDS.cancelPermit, async (msg) => {
    const p = msg.payload as { id: string; reason: string };
    // Wave 3 cross-service wiring: cancellation is citizen-meaningful — same
    // reasoning as suspendPermit above.
    const application = await findApplicationForPermit(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", msg.actorId, {
        cancelledAt: new Date(),
        cancellationReason: p.reason,
      });
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.permitCancelled, eventType: EVENTS.permitCancelled, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.id, reason: p.reason } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: application?.advertiserName ?? "Permit holder",
        recipientId: application?.createdBy ?? msg.actorId,
        variables: { permitId: p.id, status: "cancelled", reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), { action: "permit.cancel", resourceType: "adv_permit", resourceId: p.id });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.id));
  });
}
