import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for procurement purchase orders.
 *
 * When a PO award is raised into eOffice for administrative approval, eOffice
 * emits `procurement.po.file_decided` once the approval chain concludes. This
 * consumer applies that decision to the PO:
 *   approved → status "approved" (+ procurement.po.approved event)
 *   rejected → status "cancelled"
 *
 * Without this, the file was approved in eOffice but the PO never moved — the
 * integration loop was open.
 */
export function registerEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.poFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const po = await repo.findPoByIdTx(tx, cb.refId, msg.tenantId);
      if (!po || po.tenantId !== msg.tenantId) return; // not ours / unknown
      // Only act on a PO still awaiting the eOffice decision.
      if (po.status !== "pending" && po.status !== "draft") return;

      if (cb.decision === "approved") {
        await repo.updatePoVersioned(tx, cb.refId, po.version ?? 1, { status: "approved", updatedBy: cb.decidedBy });
        await enqueue(tx, {
          topic: EVENTS.poApproved, eventType: EVENTS.poApproved,
          tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
          payload: { poId: cb.refId, poNo: po.poNo, vendorId: po.vendorId, totalMinor: String(po.totalMinor) },
        });
        await audit(tx, msg, "eoffice_approved", cb.refId, { fileNo: cb.fileNo, dscHash: cb.dscHash ?? null });
      } else if (cb.decision === "rejected") {
        await repo.updatePoVersioned(tx, cb.refId, po.version ?? 1, { status: "cancelled", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo });
      } else {
        // "returned" — leave in its current state for revision (no state change).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", cb.refId));
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
    payload: { service: "procurement", action, resourceType: "po", resourceId, outcome: "success", metadata },
  });
}
