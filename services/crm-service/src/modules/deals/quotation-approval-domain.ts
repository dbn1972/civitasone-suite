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
  requestedDiscountBps?: number,
): Record<string, number | string> {
  return {
    approvalType,
    discountBps,
    maxDiscountBps: threshold?.maxDiscountBps ?? 0,
    ...(requestedDiscountBps !== undefined ? { requestedDiscountBps } : {}),
  };
}

/**
 * QP-004: derive the effective discount (basis points) of a quotation SERVER-SIDE from
 * its line items, comparing each quoted unit price to the line's reference (catalogue /
 * price-book) unit price. Client-supplied discount figures are never trusted for the gate.
 *
 * Only lines that carry a reference price contribute; a line with no reference (no product
 * link) cannot be discounted against a list price and is ignored. All arithmetic is BigInt
 * paise — no float touches a money value. Returns 0 when there is no reference basis or the
 * quote is at/above reference (a premium, not a discount).
 */
export interface ReferenceLine {
  refUnitMinor: string | null;
  unitPriceMinor: string;
  quantity: number;
}

export function effectiveDiscountBps(lines: readonly ReferenceLine[]): number {
  let refTotal = 0n;
  let quotedTotal = 0n;
  for (const l of lines) {
    if (l.refUnitMinor === null) continue;
    const qty = BigInt(l.quantity);
    refTotal += BigInt(l.refUnitMinor) * qty;
    quotedTotal += BigInt(l.unitPriceMinor) * qty;
  }
  if (refTotal <= 0n) return 0;
  const discount = refTotal - quotedTotal;
  if (discount <= 0n) return 0;
  // Basis points of the reference total, floored — integer maths only.
  return Number((discount * 10000n) / refTotal);
}
