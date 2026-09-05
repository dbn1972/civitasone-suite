/**
 * Cross-service outbox helpers for refund-service — emits notification.send
 * (citizen-facing refund status updates) via the shared @civitasone/events
 * contract.
 *
 * Wave 3 scope decision (read before extending this file): unlike the 17
 * municipal Sec5 licensing services (shop, trade, building, vendor, ...),
 * this file deliberately does NOT wire finance.challan.create /
 * buildMunicipalFeeChallanPayload. That contract
 * (packages/events/src/municipal-cross.ts) models a fee being ASSESSED and
 * deposited INTO a treasury head — money flowing IN. Every command this
 * service handles (approve/reject/return a refund request, initiate/
 * complete/fail a bank disbursement) represents money that was already
 * collected by some OTHER municipal service leaving the treasury back to a
 * citizen's bank account — the opposite cash direction. Emitting a fee
 * challan here would tell finance-service to book an incoming receipt for
 * money that is actually going out: not a stretch of the existing contract,
 * but backwards bookkeeping.
 *
 * packages/events/src/ has no finance.refund.*, finance.payment.reverse, or
 * other outbound-payment/reversal contract as of this pass (the whole
 * package was read before writing this file). The one existing "refund"
 * event in the codebase — revenue.refund.processed
 * (services/revenue-service/src/topics.ts, consumed by
 * services/finance-service/src/modules/gl/consumer.ts as a GL reversal) —
 * is bespoke, direct plumbing owned by revenue-service and finance-service
 * for revenue-service's own (different) refund domain; it is not exported
 * via @civitasone/events for reuse and its payload shape was never designed
 * for this service. Introducing a genuine shared outbound-payment contract
 * is a finance-service-ledger-owning decision, out of scope for a
 * per-service Wave 3 wiring pass. This file therefore wires
 * notification.send only — see the PR description for the full reasoning.
 *
 * Bank account details (accountNumber/ifscCode) are intentionally never
 * passed into `variables` below: those render into an SMS/email template,
 * and this service already treats them as sensitive (see
 * reconciliation/schema.ts) — only requestId/requestNumber/decision/amount
 * go into the notification payload.
 */
import {
  NOTIFICATION_SEND,
  MUNICIPAL_EVENT_TYPES,
  buildMunicipalStatusNotification,
  municipalDecisionNotificationEventType,
} from "@civitasone/events";
import { enqueue } from "./outbox.js";
import type { ScopedTx } from "./db.js";

export type CrossEventCtx = {
  tenantId: string;
  actorId: string;
  correlationId: string;
};

/** Enqueue notification.send for a citizen-facing refund status change. */
export async function emitMunicipalNotification(
  tx: ScopedTx,
  ctx: CrossEventCtx,
  opts: {
    eventType: string;
    recipient: string;
    recipientId?: string;
    variables?: Record<string, string>;
  },
): Promise<void> {
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: buildMunicipalStatusNotification(opts),
  });
}

export { municipalDecisionNotificationEventType, MUNICIPAL_EVENT_TYPES };
