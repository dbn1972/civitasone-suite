import { enqueue } from "./outbox.js";

/** workflow-service command (its COMMANDS.closeInstanceByRef). */
export const WORKFLOW_CLOSE_BY_REF = "workflow.instance.close_by_ref";

/**
 * B9-wf1: tell workflow-service this record was decided, so any approval
 * instance still open for it (and its pending inbox task) is closed with the
 * same decision. Called from the plan / PO amendment approve and reject
 * consumers in the decision's own transaction. When the decision came from
 * the workflow task itself the instance is already completed and
 * workflow-service treats this as a no-op, so it is always safe to send.
 */
export async function closeWorkflowForRef(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  refType: "procurement_plan" | "procurement_po_amendment",
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
