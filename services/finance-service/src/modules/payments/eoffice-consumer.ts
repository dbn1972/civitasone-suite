import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * D7 (payment) — closes the eOffice decision loop for finance payments.
 *
 * When a payment was raised into eOffice for administrative approval, eOffice
 * emits `finance.payment.file_decided` once the SO→US→DS chain concludes.
 * This consumer applies that decision to the payment:
 *   approved → status "released" (+ finance.payment.made event)
 *   rejected → status "cancelled"
 *   returned → no state change
 *
 * Without this, the file was approved in eOffice but the payment never moved —
 * the integration loop was open. Mirrors budget/eoffice-consumer.ts (sanctions).
 */
export function registerPaymentEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.paymentFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const payment = await repo.findPaymentByIdTx(tx, cb.refId);
      if (!payment || payment.tenantId !== msg.tenantId) return; // not ours / unknown
      // Only act on a payment still awaiting the eOffice decision.
      if (payment.status !== "pending_approval" && payment.status !== "initiated") return;

      if (cb.decision === "approved") {
        await repo.updatePayment(tx, cb.refId, { status: "released", updatedBy: cb.decidedBy });
        await enqueue(tx, {
          topic: EVENTS.paymentMade, eventType: EVENTS.paymentMade,
          tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
          payload: { paymentId: cb.refId, billId: payment.billId, amountMinor: Number(payment.amountMinor), mode: payment.mode },
        });
        await audit(tx, msg, "eoffice_approved", cb.refId, { fileNo: cb.fileNo, dscHash: cb.dscHash ?? null });
      } else if (cb.decision === "rejected") {
        await repo.updatePayment(tx, cb.refId, { status: "cancelled", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo });
      } else {
        // "returned" — leave as-is for revision (no state change needed).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payment", cb.refId));
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
    payload: { service: "finance", action, resourceType: "payment", resourceId, outcome: "success", metadata },
  });
}
