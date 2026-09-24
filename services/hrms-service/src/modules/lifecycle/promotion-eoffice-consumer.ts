import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/** ISO 'YYYY-MM-DD' for "today", used to decide whether an effectiveDate is due. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Closes the eOffice decision loop for HR promotions.
 *
 * When a promotion is submitted for approval (see employee/commands.ts
 * `submitPromotionForApproval`), a promotion request is recorded in
 * `pending_approval` and an eFile is raised into eOffice (source_ref_type
 * "hr_promotion"). Once the approval chain concludes, estab-service emits
 * `hrms.promotion.file_decided` and this consumer applies the decision:
 *   approved → the eOffice decision alone doesn't move the promotion straight
 *              to "completed" any more (migration 0144): it first flips to
 *              "pending_effective", and only continues on to actually effect
 *              it — new designation (and basic pay, when carried) applied to
 *              the employee master, status "completed" — when the
 *              promotion's own effectiveDate is today or earlier. A
 *              future-dated approval stays "pending_effective" until the
 *              scheduler (lifecycle/effective-scheduler.ts) finds it due.
 *   rejected → flip the request to "cancelled"; the employee is left unchanged.
 *   returned → leave the request pending for revision (audit only).
 *
 * Mirrors modules/lifecycle/eoffice-consumer.ts (transfer). Without this, the
 * file was approved in eOffice but the promotion never moved — the integration
 * loop was open.
 */
export function registerPromotionEOfficeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.promotionFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    let affectedEmployeeId: string | null = null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (cb.decision === "approved") {
        // Guarded execution: only a promotion still awaiting the eOffice
        // decision is effected. Tenant-scoped + status-guarded.
        //
        // Effective-dating fix (migration 0144): the eOffice decision only
        // means the ORDER is approved — the promotion's own effectiveDate
        // still governs when it actually lands on the employee master. Every
        // approval moves the row to "pending_effective" first; only when
        // that date is today or earlier does it immediately continue on to
        // "completed" + apply. A future-dated approval is left at
        // "pending_effective" for the scheduler
        // (lifecycle/effective-scheduler.ts) to pick up once due. Both
        // transitions happen inside this same transaction, so a concurrent
        // reader never observes the intermediate state — see
        // lifecycle/repo.ts's transitionPromotion doc comment.
        const pending = await repo.transitionPromotion(msg.tenantId, cb.refId, cb.decidedBy, {
          from: ["pending_approval"], to: "pending_effective",
        }, tx);
        if (!pending) return; // not ours / already decided
        affectedEmployeeId = pending.employeeId;

        if (repo.isEffectiveDateDue(pending.effectiveDate, todayISO())) {
          const promotion = await repo.transitionPromotion(msg.tenantId, cb.refId, cb.decidedBy, {
            from: ["pending_effective"], to: "completed",
          }, tx);
          if (promotion) {
            // Concurrency guard: this eOffice-approved promotion can carry a
            // basicMinor change that lands close together with the direct
            // promotion route, the pay-matrix annual increment, or a generic
            // employee-update — all independent, asynchronous writers of the
            // same field. applyPromotionEffect reads the row's current
            // version fresh, inside this transaction, and uses it as an
            // optimistic-concurrency precondition so this write can never
            // silently clobber (or be silently clobbered by) one of those.
            // See employee/repo.ts updateEmployeeVersioned.
            await repo.applyPromotionEffect(tx, promotion, cb.decidedBy);
          }
        }
        await audit(tx, msg, "eoffice_approved", cb.refId, {
          fileNo: cb.fileNo, employeeId: pending.employeeId,
          toDesigId: pending.toDesigId, dscHash: cb.dscHash ?? null,
        });
      } else if (cb.decision === "rejected") {
        const promotion = await repo.transitionPromotion(msg.tenantId, cb.refId, cb.decidedBy, {
          from: ["pending_approval"], to: "cancelled",
        }, tx);
        if (!promotion) return;
        affectedEmployeeId = promotion.employeeId;
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo, employeeId: promotion.employeeId });
      } else {
        // "returned" — leave the request pending for revision (no state change).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "promotion", cb.refId));
    if (affectedEmployeeId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "employee", affectedEmployeeId));
    }
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType: "promotion", resourceId, outcome: "success", metadata },
  });
}
