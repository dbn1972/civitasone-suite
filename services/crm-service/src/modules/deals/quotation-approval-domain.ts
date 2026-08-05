/**
 * Pure quotation-approval threshold maths (QP-004).
 *
 * A discount/deviation is an EXCEPTION when it exceeds the configured threshold. An
 * exception must be APPROVED before the quotation can be sent (issued) as final; a
 * within-threshold request needs no sign-off and is recorded as auto-approved.
 * Discount is basis points (bps): 1000 = 10%.
 */

export const APPROVAL_TYPES = ["discount", "deviation", "credit", "commercial"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** True when the requested discount exceeds the tenant threshold and needs sign-off. */
export function breachesThreshold(discountBps: number, maxDiscountBps: number): boolean {
  return discountBps > maxDiscountBps;
}

/**
 * Decide the initial status of a newly requested approval. When no threshold is
 * configured the tenant has no policy, so any exception is treated as needing approval
 * (fail safe / loud); when configured, only a breach needs approval.
 */
export function initialStatus(
  discountBps: number,
  threshold: { maxDiscountBps: number; enabled: boolean } | null,
): ApprovalStatus {
  if (threshold === null || !threshold.enabled) {
    // No active policy: a zero-discount request is trivially fine; anything above 0 is
    // an exception someone must own.
    return discountBps > 0 ? "pending" : "approved";
  }
  return breachesThreshold(discountBps, threshold.maxDiscountBps) ? "pending" : "approved";
}

/** Snapshot recorded on the approval row for auditability. */
export function breachSnapshot(
  approvalType: ApprovalType,
  discountBps: number,
  threshold: { maxDiscountBps: number } | null,
): Record<string, number | string> {
  return {
    approvalType,
    discountBps,
    maxDiscountBps: threshold?.maxDiscountBps ?? 0,
  };
}
