import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import { minorString } from "@civitasone/schemas/money";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * D7 — closes the eOffice decision loop for finance sanctions.
 *
 * When a sanction was raised into eOffice for administrative approval, eOffice
 * emits `finance.sanction.file_decided` once the SO→US→DS chain concludes.
 * This consumer applies that decision to the sanction:
 *   approved → status "approved" (+ finance.sanction.approved event)
 *   rejected → status "cancelled"
 *
 * Without this, the file was approved in eOffice but the sanction never moved —
 * the integration loop was open.
 */
export function registerEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.sanctionFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const sanction = await repo.findSanctionByIdTx(tx, cb.refId);
      if (!sanction || sanction.tenantId !== msg.tenantId) return; // not ours / unknown
      // Only act on a sanction still awaiting the eOffice decision.
      if (sanction.status !== "pending_approval" && sanction.status !== "draft") return;

      if (cb.decision === "approved") {
        await repo.updateSanction(tx, cb.refId, { status: "approved", updatedBy: cb.decidedBy });
        await enqueue(tx, {
          topic: EVENTS.sanctionApproved, eventType: EVENTS.sanctionApproved,
          tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
          payload: { sanctionId: cb.refId, headId: sanction.headId, amountMinor: minorString(sanction.amountMinor) },
        });
        await audit(tx, msg, "eoffice_approved", cb.refId, { fileNo: cb.fileNo, dscHash: cb.dscHash ?? null });
      } else if (cb.decision === "rejected") {
        await repo.updateSanction(tx, cb.refId, { status: "cancelled", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo });
      } else {
        // "returned" — leave as draft for revision (no state change needed).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", cb.refId));
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
    payload: { service: "finance", action, resourceType: "sanction", resourceId, outcome: "success", metadata },
  });
}
