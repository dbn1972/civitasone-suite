/**
 * GAP-FINANCE-VENDORS-DETAIL-03/05/06/07: pure rules for the vendor detail
 * page's bill roll-up, so each stat card means what its label says.
 *
 * The vendor payload's bills[] comes from finance-service masters/routes.ts
 * toVendorBillHistory: { id, billNo, date, amount, tds, status } where amount
 * is the bill's net paise as a string and status is the raw bill status
 * (pending | passed | paid | rejected | on_hold | under_review; payments
 * consumer.ts:407 sets "paid" when the payment is INITIATED, i.e. before PFMS
 * release / bank settlement, so "paid" means "payment initiated", not "money
 * settled"). Money is bigint
 * paise throughout: never Number().
 */

/** Bill statuses that mean a payment has been initiated for the bill (not necessarily settled). */
export const PAID_BILL_STATUSES: readonly string[] = ["paid"];

export type RawRecord = Record<string, unknown>;

/** Exact paise from a loosely-typed field (bigint | integer number | integer string), else undefined. */
export function minorOf(data: RawRecord, ...keys: string[]): bigint | undefined {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === "string") {
      const t = v.trim();
      if (/^-?\d+$/.test(t)) return BigInt(t);
    }
  }
  return undefined;
}

function statusOf(b: RawRecord): string {
  const v = b.status;
  return typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

export function isPaidBill(b: RawRecord): boolean {
  return PAID_BILL_STATUSES.includes(statusOf(b));
}

export interface BillTotals {
  /** Sum over every bill, whatever its status. undefined when no bill carries an amount. */
  billedMinor: bigint | undefined;
  /** Sum over PAID bills only. undefined when no paid bill carries an amount. */
  paidMinor: bigint | undefined;
  /** TDS recorded on PAID bills only (TDS is deducted when the bill is paid). */
  tdsOnPaidMinor: bigint | undefined;
}

function sumOver(rows: readonly RawRecord[], ...keys: string[]): bigint | undefined {
  let total: bigint | undefined;
  for (const r of rows) {
    const m = minorOf(r, ...keys);
    if (m !== undefined) total = (total ?? 0n) + m;
  }
  return total;
}

export function billTotals(bills: readonly RawRecord[]): BillTotals {
  const paid = bills.filter(isPaidBill);
  return {
    billedMinor: sumOver(bills, "amountMinor", "amount"),
    paidMinor: sumOver(paid, "amountMinor", "amount"),
    tdsOnPaidMinor: sumOver(paid, "tdsMinor", "tds"),
  };
}

/** "{bank} ({ifsc})" built from whichever parts exist; a single "—" when neither does. */
export function bankLine(bankName: string, ifsc: string): string {
  const parts = [bankName, ifsc].filter((p) => p !== "" && p !== "—");
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} (${parts[1]})`;
}
