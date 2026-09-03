import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for HR promotions.
 *
 * When a promotion is submitted for approval (see employee/commands.ts
 * `submitPromotionForApproval`), a promotion request is recorded in
 * `pending_approval` and an eFile is raised into eOffice (source_ref_type
 * "hr_promotion"). Once the approval chain concludes, estab-service emits
 * `hrms.promotion.file_decided` and this consumer applies the decision:
 *   approved → effect the promotion: flip the request to "completed" and apply
 *              the new designation (and basic pay, when carried) to the
 *              employee master — the same state-change the synchronous
 *              POST /v1/hrms/lifecycle/promotions route effects.
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
        const promotion = await repo.transitionPromotion(msg.tenantId, cb.refId, cb.decidedBy, {
          from: ["pending_approval"], to: "completed",
        }, tx);
        if (!promotion) return; // not ours / already decided
        affectedEmployeeId = promotion.employeeId;
        // Concurrency guard: this eOffice-approved promotion can carry a
        // basicMinor change that lands close together with the direct
        // promotion route, the pay-matrix annual increment, or a generic
        // employee-update — all independent, asynchronous writers of the
        // same field. Read the row's current version fresh, inside this
        // transaction, and use it as an optimistic-concurrency precondition
        // so this write can never silently clobber (or be silently
        // clobbered by) one of those. See employee/repo.ts updateEmployeeVersioned.
        const emp = await employeeRepo.findVersionForUpdate(tx, promotion.employeeId, msg.tenantId);
        if (!emp) throw new HttpError(404, "NOT_FOUND", `employee ${promotion.employeeId} not found`);
        const patch: Parameters<typeof employeeRepo.updateEmployeeVersioned>[4] = {
          designationId: promotion.toDesigId,
        };
        if (promotion.newBasicMinor !== null) patch.basicMinor = promotion.newBasicMinor;
        await employeeRepo.updateEmployeeVersioned(tx, promotion.employeeId, msg.tenantId, emp.version, patch, cb.decidedBy);
        await audit(tx, msg, "eoffice_approved", cb.refId, {
          fileNo: cb.fileNo, employeeId: promotion.employeeId,
          toDesigId: promotion.toDesigId, dscHash: cb.dscHash ?? null,
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
