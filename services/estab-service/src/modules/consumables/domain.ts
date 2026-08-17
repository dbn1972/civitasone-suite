/**
 * Consumables domain logic — pure functions, no IO.
 * Reorder threshold check + transaction-type balance effects.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export type ConsumableTxnType = "receipt" | "issue" | "adjustment" | "return";

/**
 * True when the item's balance has fallen to or below its reorder level and
 * a reorder policy is actually configured. A `reorderLevel` of 0 means "no
 * reorder policy" for this item, so it never triggers — otherwise every item
 * with a default (unset) reorder level would appear as perpetually low-stock.
 */
export function isReorderRequired(balance: number, reorderLevel: number): boolean {
  if (reorderLevel <= 0) return false;
  return balance <= reorderLevel;
}

/**
 * Signed delta this transaction type applies to the item's balance, given
 * the transaction's (always-positive, per the route's zod schema) qty.
 * - receipt / return: stock coming in → increases balance
 * - issue: stock going out → decreases balance
 * - adjustment: qty carries its own sign (correction either direction)
 */
export function computeBalanceDelta(txnType: ConsumableTxnType, qty: number): number {
  switch (txnType) {
    case "receipt":
    case "return":
      return Math.abs(qty);
    case "issue":
      return -Math.abs(qty);
    case "adjustment":
      return qty;
    default:
      throw new DomainError("INVALID_TXN_TYPE", `unknown transaction type: ${txnType}`);
  }
}

/**
 * Guard against a transaction that would drive the balance negative.
 * Consumables stock can never go below zero — an issue or a negative
 * adjustment larger than the current balance is rejected rather than
 * silently clamped, so the discrepancy surfaces to the caller.
 */
export function assertSufficientBalance(currentBalance: number, delta: number): void {
  if (currentBalance + delta < 0) {
    throw new DomainError(
      "INSUFFICIENT_BALANCE",
      `transaction would drive balance negative: ${currentBalance} + (${delta}) < 0`,
    );
  }
}

/**
 * Full validation for a proposed transaction against the item's current
 * balance. Returns the resulting balance on success; throws DomainError
 * (INSUFFICIENT_BALANCE) when the transaction is not applicable.
 */
export function applyTransaction(
  currentBalance: number,
  txnType: ConsumableTxnType,
  qty: number,
): number {
  const delta = computeBalanceDelta(txnType, qty);
  assertSufficientBalance(currentBalance, delta);
  return currentBalance + delta;
}
