/**
 * Pure stock-movement domain logic — no IO, fully unit-testable.
 *
 *   weightedAvgRate  : moving weighted-average cost (paise) on a receipt
 *   assertSufficientStock : guards issues/transfers from driving stock negative
 *   isLowStock       : reorder-level breach detection
 *   valuationMinor   : line/stock valuation in paise
 *   suggestedReorderQty : how much to reorder when low
 */
import { DomainError } from "../../shared/domain.js";

export type MovementType = "receipt" | "issue" | "transfer" | "adjustment";

export interface BalanceState {
  qty: number;
  rateMinor: bigint;
}

/**
 * Moving weighted average:
 *   new_rate = (old_qty*old_rate + recv_qty*recv_rate) / (old_qty + recv_qty)
 * Integer (paise) floor division — matches stock-service costing. When the
 * combined quantity is zero the rate is left at zero.
 */
export function weightedAvgRate(current: BalanceState, receiptQty: number, receiptRateMinor: bigint): bigint {
  const totalQty = BigInt(current.qty + receiptQty);
  if (totalQty === 0n) return 0n;
  return (BigInt(current.qty) * current.rateMinor + BigInt(receiptQty) * receiptRateMinor) / totalQty;
}

/** Reject an outbound movement that would drive on-hand stock negative. */
export function assertSufficientStock(availableQty: number, requestedQty: number): void {
  if (requestedQty > availableQty) {
    throw new DomainError(
      "INSUFFICIENT_STOCK",
      `requested qty ${requestedQty} exceeds available stock ${availableQty}`,
    );
  }
}

/** Total value of `qty` units at `rateMinor` paise each. */
export function valuationMinor(qty: number, rateMinor: bigint): bigint {
  return BigInt(qty) * rateMinor;
}

/**
 * A reorder level of 0 means "not tracked". An item is low when its on-hand
 * quantity has fallen to or below a positive reorder level.
 */
export function isLowStock(onHandQty: number, reorderLevel: number): boolean {
  return reorderLevel > 0 && onHandQty <= reorderLevel;
}

/**
 * Suggested replenishment quantity: bring stock back up to (reorder level +
 * reorder qty), but never suggest a negative number. Falls back to the
 * configured reorder qty when no explicit top-up is needed.
 */
export function suggestedReorderQty(onHandQty: number, reorderLevel: number, reorderQty: number): number {
  const target = reorderLevel + reorderQty;
  const gap = target - onHandQty;
  return Math.max(gap, reorderQty, 0);
}
