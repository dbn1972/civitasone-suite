export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type EntryType = "receipt" | "issue" | "transfer" | "adjustment";

export interface ValuationState {
  qty:       number;
  rateMinor: bigint;
}

/**
 * Weighted average: new_rate = (old_qty * old_rate + recv_qty * recv_rate) / (old_qty + recv_qty)
 */
export function weightedAvgRate(current: ValuationState, receiptQty: number, receiptRateMinor: bigint): bigint {
  const totalQty = BigInt(current.qty + receiptQty);
  if (totalQty === 0n) return 0n;
  return (BigInt(current.qty) * current.rateMinor + BigInt(receiptQty) * receiptRateMinor) / totalQty;
}

/** Reject issue if qty > current stock balance. */
export function assertStockNotNegative(currentQty: number, issueQty: number): void {
  if (issueQty > currentQty) {
    throw new DomainError(
      "INSUFFICIENT_STOCK",
      `issue qty ${issueQty} exceeds available stock ${currentQty}`
    );
  }
}

export function voucherTypeForEntry(entryType: EntryType, side: "from" | "to"): string {
  switch (entryType) {
    case "receipt":    return "receipt";
    case "issue":      return "issue";
    case "transfer":   return side === "from" ? "transfer_out" : "transfer_in";
    case "adjustment": return "adjustment";
  }
}
