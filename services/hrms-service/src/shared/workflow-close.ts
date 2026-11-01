import { enqueue } from "./outbox.js";

/** workflow-service command (its COMMANDS.closeInstanceByRef). */
export const WORKFLOW_CLOSE_BY_REF = "workflow.instance.close_by_ref";

/**
 * F125: tell workflow-service this leave application was decided outside its
 * approval task (a direct manager / HR approve or reject, or a cancel while
 * still pending), so the `leave_approval` instance still open for it and its
 * pending "Reporting Officer Approval" inbox task are closed with the same
 * decision. Mirrors procurement-service's shared/workflow-close.ts (F102).
 * Called in the decision's own transaction. When the decision came from the
 * workflow task itself the instance is already completed and workflow-service
 * treats this as a no-op, so it is always safe to send.
 */
export async function closeWorkflowForRef(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  refType: "leave_app",
  refId: string,
  decision: "approve" | "reject",
  reason?: string | null,
): Promise<void> {
  await enqueue(tx, {
    topic: WORKFLOW_CLOSE_BY_REF, eventType: WORKFLOW_CLOSE_BY_REF,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { tenantId: msg.tenantId, refType, refId, decision, ...(reason ? { reason } : {}) },
  });
}
