/**
 * Cross-service outbox helpers for this municipal Sec5 service — emits
 * finance.challan.create (fee assessed) and notification.send (applicant
 * status updates) via the shared @civitasone/events contract.
 *
 * Ported from the building-service / shop-service Wave 3 templates
 * (services/building-service/src/shared/cross-events.ts,
 * services/shop-service/src/shared/cross-events.ts) — same shape, this
 * service's own SERVICE constant.
 *
 * Wave 3: wired into applications/consumer.ts (fee challan + fee-due
 * notification at application creation, submitted/decision notifications at
 * the corresponding transitions), permits/consumer.ts (issue notification)
 * and restoration/consumer.ts (deposit-refund decision notification) — see
 * those files for call sites.
 *
 * Deliberately NOT wired to roadcut's `depositMinor` (the refundable
 * restoration security deposit computed alongside `feeMinor` in
 * applications/domain.ts's calculateDepositMinor): finance-service books
 * finance.challan.create as non-tax REVENUE against the 0075 municipal-fee
 * head (see @civitasone/events' MUNICIPAL_FEE_RECEIPT_HEAD_CODE and
 * finance-service/src/modules/treasury/consumer.ts's challanCreate
 * handler). A refundable deposit is a LIABILITY, not revenue — finance
 * already has a separate, correctly-modelled path for exactly this
 * (COMMANDS.depositCreate -> Dr Bank / Cr Deposits-liability control head
 * "2060", see treasury/consumer.ts's registerTreasuryConsumers). Routing
 * the security deposit through emitMunicipalFeeChallan would silently
 * misbook a refundable liability as non-tax income. Wiring a
 * `finance.deposit.create` cross-event is real, correct follow-up work, but
 * it is a different event contract than the one this Wave 3 pass (and the
 * shared @civitasone/events helpers this file re-exports) provides —
 * flagged in this PR's description rather than guessed at here.
 */
import { randomUUID } from "node:crypto";
import {
  FINANCE_CHALLAN_CREATE,
  NOTIFICATION_SEND,
  MUNICIPAL_EVENT_TYPES,
  buildMunicipalFeeChallanPayload,
  buildMunicipalStatusNotification,
  municipalDecisionNotificationEventType,
} from "@civitasone/events";
import { enqueue } from "./outbox.js";
import type { ScopedTx } from "./db.js";
import { SERVICE } from "../topics.js";

export type CrossEventCtx = {
  tenantId: string;
  actorId: string;
  correlationId: string;
};

/**
 * Defensive ceiling on amountMinor. Unlike shop-service/building-service,
 * roadcut's fee inputs (cuttingLength/cuttingWidth, applications/routes.ts's
 * `positiveDecimalString`) are bounded only by a 12-character decimal-string
 * length, not a small integer cap — so, unlike those services' comments,
 * this is NOT "the largest value the real calculator can produce given the
 * route's real-world bounds", it is a hard backstop against a
 * pathological-but-technically-valid input (or a corrupted/replayed queue
 * message) reaching finance-service's ledger with an absurd amount. Mirrors
 * shop-service/src/shared/cross-events.ts's MAX_FEE_CHALLAN_AMOUNT_MINOR
 * (same value, same "fail loudly instead of silently emitting a fee challan
 * for an unbounded or corrupted amount" reasoning).
 */
export const MAX_FEE_CHALLAN_AMOUNT_MINOR = 100_000_000_00n; // Rs 1,00,00,000 (1 crore) in paise

/** Enqueue finance.challan.create when a licensing fee is assessed (fee > 0). */
export async function emitMunicipalFeeChallan(
  tx: ScopedTx,
  ctx: CrossEventCtx,
  opts: {
    sourceRef: string;
    depositor: string;
    amountMinor: bigint;
    currency?: string;
    receiptHeadCode?: string;
  },
): Promise<void> {
  if (opts.amountMinor <= 0n) return;
  if (opts.amountMinor > MAX_FEE_CHALLAN_AMOUNT_MINOR) {
    throw new RangeError(
      `emitMunicipalFeeChallan: amountMinor ${opts.amountMinor} exceeds the defensive ceiling ` +
        `(${MAX_FEE_CHALLAN_AMOUNT_MINOR}); refusing to enqueue finance.challan.create for sourceRef=${opts.sourceRef}`,
    );
  }
  const payloadInput: Parameters<typeof buildMunicipalFeeChallanPayload>[0] = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    depositor: opts.depositor,
    amountMinor: opts.amountMinor,
    sourceService: SERVICE,
    sourceRef: opts.sourceRef,
  };
  if (opts.currency) payloadInput.currency = opts.currency;
  if (opts.receiptHeadCode) payloadInput.receiptHeadCode = opts.receiptHeadCode;
  await enqueue(tx, {
    topic: FINANCE_CHALLAN_CREATE,
    eventType: FINANCE_CHALLAN_CREATE,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: buildMunicipalFeeChallanPayload(payloadInput),
  });
}

/** Enqueue notification.send for applicant-facing status changes. */
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
