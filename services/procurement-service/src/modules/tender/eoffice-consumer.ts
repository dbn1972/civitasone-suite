import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for procurement tender awards.
 *
 * When a tender award is raised into eOffice for administrative approval
 * (source_ref_type "procurement_award"), estab-service emits
 * `procurement.award.file_decided` once the approval chain concludes. This
 * consumer applies the decision:
 *   approved → mark the tender "awarded" (+ emit procurement.tender.awarded event).
 *   rejected → mark the tender "cancelled".
 *   returned → leave in pending state for revision (audit only).
 *
 * Without this, the file was approved in eOffice but the tender award never
 * moved — the integration loop was open.
 */
export function registerAwardEOfficeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.awardFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const tender = await repo.findTenderByIdTx(tx, cb.refId, msg.tenantId);
      if (!tender) return; // not ours / unknown
      // Only act on a tender still awaiting the eOffice decision.
      if (tender.status !== "pending_approval") return;

      if (cb.decision === "approved") {
        await repo.updateTenderVersioned(tx, cb.refId, tender.version, { status: "awarded", updatedBy: cb.decidedBy });
        await enqueue(tx, {
          topic: EVENTS.tenderAwarded, eventType: EVENTS.tenderAwarded,
          tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
          payload: { tenderId: cb.refId, tenderNo: tender.tenderNo, awardedVendorId: tender.awardedVendorId ?? null },
        });
        await audit(tx, msg, "eoffice_approved", cb.refId, {
          fileNo: cb.fileNo, tenderNo: tender.tenderNo, dscHash: cb.dscHash ?? null,
        });
      } else if (cb.decision === "rejected") {
        await repo.updateTenderVersioned(tx, cb.refId, tender.version, { status: "cancelled", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo, tenderNo: tender.tenderNo });
      } else {
        // "returned" — leave the tender pending for revision (no state change).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", cb.refId));
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
    payload: { service: "procurement", action, resourceType: "procurement_award", resourceId, outcome: "success", metadata },
  });
}
