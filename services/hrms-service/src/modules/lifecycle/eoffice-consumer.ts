import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for HR transfers.
 *
 * When a transfer is submitted for approval (see employee/commands.ts
 * `submitTransferForApproval`), a transfer request is recorded in
 * `pending_approval` and an eFile is raised into eOffice (source_ref_type
 * "hr_transfer"). Once the approval chain concludes, estab-service emits
 * `hrms.transfer.file_decided` and this consumer applies the decision:
 *   approved → execute the transfer: flip the request to "completed" and apply
 *              the posting (department/designation) to the employee master —
 *              the same state-change the hrms.employee.transfer command effects.
 *   rejected → flip the request to "cancelled"; the employee is left unchanged.
 *   returned → leave the request pending for revision (audit only).
 *
 * Without this, the file was approved in eOffice but the transfer never moved —
 * the integration loop was open.
 */
export function registerEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.transferFileDecided, async (msg) => {
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
        // Guarded execution: only a transfer still awaiting the eOffice decision
        // is moved. Reuses the existing lifecycle transition helper.
        const transfer = await repo.transitionTransfer(msg.tenantId, cb.refId, cb.decidedBy, {
          from: ["pending_approval"], to: "completed",
        }, tx);
        if (!transfer) return; // not ours / already decided
        affectedEmployeeId = transfer.employeeId;
        const patch: Parameters<typeof employeeRepo.updateEmployee>[2] = {
          departmentId: transfer.toDeptId, updatedBy: cb.decidedBy,
        };
        if (transfer.toDesigId) patch.designationId = transfer.toDesigId;
        await employeeRepo.updateEmployee(tx, transfer.employeeId, patch);
        await audit(tx, msg, "eoffice_approved", cb.refId, {
          fileNo: cb.fileNo, employeeId: transfer.employeeId, dscHash: cb.dscHash ?? null,
        });
      } else if (cb.decision === "rejected") {
        const transfer = await repo.transitionTransfer(msg.tenantId, cb.refId, cb.decidedBy, {
          from: ["pending_approval"], to: "cancelled",
        }, tx);
        if (!transfer) return;
        affectedEmployeeId = transfer.employeeId;
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo, employeeId: transfer.employeeId });
      } else {
        // "returned" — leave the request pending for revision (no state change).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "transfer", cb.refId));
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
    payload: { service: "hrms", action, resourceType: "transfer", resourceId, outcome: "success", metadata },
  });
}
