import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for special leave applications.
 *
 * When a special leave (e.g. study leave, sabbatical, extraordinary leave) is
 * raised into eOffice for administrative approval (source_ref_type
 * "hr_leave_special"), estab-service emits `hrms.leave_special.file_decided`
 * once the approval chain concludes. This consumer applies the decision:
 *   approved → mark the leave application "approved" and debit the balance.
 *   rejected → mark the leave application "rejected".
 *   returned → leave in pending state for revision (audit only).
 *
 * Without this, the file was approved in eOffice but the leave never moved —
 * the integration loop was open.
 */
export function registerLeaveSpecialEOfficeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.leaveSpecialFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    let employeeId: string | null = null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const app = await repo.findLeaveAppById(cb.refId, msg.tenantId);
      if (!app) return; // not ours / unknown
      // Only act on a leave app still awaiting the eOffice decision.
      if (app.status !== "pending_approval") return;

      employeeId = app.employeeId;

      if (cb.decision === "approved") {
        await repo.debitLeaveBalance(tx, app.allocId, app.daysApplied);
        await repo.updateLeaveApp(tx, cb.refId, { status: "approved", approvedBy: cb.decidedBy, updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_approved", cb.refId, {
          fileNo: cb.fileNo, employeeId: app.employeeId, dscHash: cb.dscHash ?? null,
        });
      } else if (cb.decision === "rejected") {
        await repo.updateLeaveApp(tx, cb.refId, { status: "rejected", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo, employeeId: app.employeeId });
      } else {
        // "returned" — leave the request pending for revision (no state change).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "leave_app", cb.refId));
    if (employeeId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "leave_apps_emp", employeeId));
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
    payload: { service: "hrms", action, resourceType: "leave_special", resourceId, outcome: "success", metadata },
  });
}
