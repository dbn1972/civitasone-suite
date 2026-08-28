export const QUALITY_STATUSES = ["satisfactory", "unsatisfactory", "pending"] as const;
export type Quality = (typeof QUALITY_STATUSES)[number];

export const DEPOSIT_REFUND_STATUSES = ["held", "partial_refund", "full_refund", "forfeited"] as const;
export type DepositRefundStatus = (typeof DEPOSIT_REFUND_STATUSES)[number];

export type RefundDecision = "full_refund" | "partial_refund" | "forfeited";

/**
 * Single source of truth for how much a deposit-refund DECISION is worth.
 * Previously keyed on restoration `quality` alone (satisfactory -> full
 * deposit, anything else -> 0) and reached for BOTH full_refund and
 * forfeited whenever the caller omitted refundMinor — so a "forfeited"
 * decision on a "satisfactory" restoration paid out the FULL deposit,
 * inverting the decision's actual meaning. Keying on `decision` instead
 * makes the admin's actual choice authoritative regardless of quality:
 * full_refund is always the whole deposit, forfeited is always zero.
 * `quality` vs. `decision` consistency (e.g. rejecting forfeited when
 * quality is "satisfactory") is validated by the caller, which has the
 * context to raise a proper HTTP error — this function only computes the
 * amount for a decision already confirmed legal.
 * partial_refund is intentionally NOT computed here: it is an explicit
 * admin-supplied amount, validated by the caller to lie strictly between
 * 0 and depositMinor.
 */
export function calculateRefundMinor(depositMinor: bigint, decision: RefundDecision): bigint {
  if (decision === "full_refund") return depositMinor;
  if (decision === "forfeited") return 0n;
  throw new Error(
    `calculateRefundMinor: '${decision}' has no computed amount — partial_refund must supply an explicit refundMinor`,
  );
}
