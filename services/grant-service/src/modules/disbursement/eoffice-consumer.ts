import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for grant disbursements.
 *
 * When a disbursement is raised into eOffice for administrative approval
 * (source_ref_type "grant_disbursement"), eOffice emits
 * `grant.disbursement.file_decided` once the approval chain concludes. This
 * consumer applies that decision to the disbursement:
 *   approved → status "initiated" (the existing approved/ready state from which
 *              the EFT flow proceeds — there is no separate disbursement-approved
 *              event to emit)
 *   rejected → status "cancelled"
 *   returned → no state change (left in pending_approval for revision)
 *
 * Without this, the file was approved in eOffice but the disbursement never
 * moved — the integration loop was open.
 */
export function registerEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.disbursementFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const disbursement = await repo.findDisbursementByIdTx(tx, cb.refId, msg.tenantId);
      if (!disbursement) return; // not ours / unknown
      // Only act on a disbursement still awaiting the eOffice decision.
      if (disbursement.status !== "pending_approval") return;

      if (cb.decision === "approved") {
        await repo.updateDisbursement(tx, cb.refId, { status: "initiated", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_approved", cb.refId, { fileNo: cb.fileNo, dscHash: cb.dscHash ?? null });
      } else if (cb.decision === "rejected") {
        await repo.updateDisbursement(tx, cb.refId, { status: "cancelled", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo });
      } else {
        // "returned" — leave as pending_approval for revision (no state change needed).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "disbursement", cb.refId));
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
    payload: { service: "grant", action, resourceType: "grant_disbursement", resourceId, outcome: "success", metadata },
  });
}
