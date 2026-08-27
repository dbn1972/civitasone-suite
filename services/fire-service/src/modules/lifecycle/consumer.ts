import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as nocRepo from "../nocs/repo.js";
import { calculateRenewalFee, calculateNewValidUntil, canRequestRenewal } from "./domain.js";

const log = pino({ name: "fire.lifecycle.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLifecycleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.requestRenewal, async (msg) => {
    const p = msg.payload as { id: string; nocId: string; renewalType: string };
    const feeMinor = calculateRenewalFee(p.renewalType as never);
    const noc = await nocRepo.findById(msg.tenantId, p.nocId);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        nocId: p.nocId,
        renewalType: p.renewalType,
        status: "requested",
        feeMinor,
        previousValidUntil: noc?.validUntil ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.renewalRequested,
        eventType: EVENTS.renewalRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { renewalId: p.id, nocId: p.nocId, renewalType: p.renewalType, feeMinor: String(feeMinor) },
      });
      await writeAudit(tx, ctxOf(msg), { action: "renewal.request", resourceType: "fire_renewal", resourceId: p.id });
    });
    log.info({ id: p.id, nocId: p.nocId }, "fire renewal requested");
  });

  queue.subscribe(COMMANDS.decideRenewal, async (msg) => {
    const p = msg.payload as { renewalId: string; decision: string };
    const renewal = await repo.findById(msg.tenantId, p.renewalId);
    if (!renewal) return;

    // CRITICAL fix: previously reactivated the NOC unconditionally on
    // approval, using only the RENEWAL record's own status/fields —
    // canRequestRenewal (the same eligibility rule used when the renewal was
    // originally requested) was never re-checked against the NOC's CURRENT
    // state at decide-time. Concrete exploit this closes: NOC is active ->
    // citizen requests renewal (passes canRequestRenewal) -> an officer
    // discovers a violation and revokes the NOC (independently, via the nocs
    // module) -> a (possibly different) officer later approves the now-stale
    // pending renewal -> the revoked NOC was silently flipped back to
    // "active", fully undoing the revocation with nothing anywhere checking
    // it had been revoked in the interim. Re-fetch the NOC's live state here,
    // right before acting on it.
    const currentNoc = await nocRepo.findById(msg.tenantId, renewal.nocId);
    const nocStillEligible = p.decision === "approved" && currentNoc
      ? canRequestRenewal(currentNoc.status, currentNoc.validUntil)
      : true; // rejection never touches the NOC, so eligibility is moot
    if (p.decision === "approved" && !nocStillEligible) {
      log.error({ renewalId: p.renewalId, nocId: renewal.nocId, nocStatus: currentNoc?.status }, "refusing to approve renewal: NOC is no longer in a renewable state (likely revoked/suspended since the renewal was requested)");
      return;
    }

    const newValidUntil = p.decision === "approved" && renewal.renewalType === "renewal" && renewal.previousValidUntil
      ? calculateNewValidUntil(new Date(renewal.previousValidUntil)).toISOString().slice(0, 10)
      : null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const status = p.decision === "approved" ? "approved" : "rejected";
      const updated = await repo.updateDecision(tx, msg.tenantId, p.renewalId, p.decision, status, newValidUntil, ["requested", "under_review"], msg.actorId);
      if (!updated) return;
      if (p.decision === "approved" && newValidUntil) {
        // Atomic guard here too: even with the pre-check above, this closes
        // the remaining race window between that check and this write.
        const nocUpdated = await nocRepo.updateStatus(tx, msg.tenantId, renewal.nocId, "active", ["issued", "active", "suspended", "expired"], msg.actorId);
        if (!nocUpdated) {
          throw new Error(`NOC ${renewal.nocId} status changed since eligibility re-check; aborting renewal approval for ${p.renewalId}`);
        }
      }
      await enqueue(tx, {
        topic: EVENTS.renewalDecided,
        eventType: EVENTS.renewalDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { renewalId: p.renewalId, nocId: renewal.nocId, decision: p.decision, newValidUntil },
      });
      await writeAudit(tx, ctxOf(msg), { action: `renewal.${p.decision}`, resourceType: "fire_renewal", resourceId: p.renewalId });
    });
  });
}
