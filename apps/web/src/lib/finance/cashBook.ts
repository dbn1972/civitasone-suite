/**
 * Pure helpers for the cash & bank book (GAP-FINANCE-TREASURY-CASH-BANK-02/03/04/06).
 * Amounts are bigint paise end to end: gl.finance_cash_book columns reach the
 * browser as integer strings, and totals are summed with BigInt, never Number.
 */
export interface CashBookLike {
  entry_date?: unknown;
  receipt_minor?: unknown;
  payment_minor?: unknown;
  balance_minor?: unknown;
}

/** Parse an integer-paise value; anything unparseable counts as zero. */
export function toPaise(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return Number.isSafeInteger(v) ? BigInt(v) : 0n;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return 0n;
}

export function isZeroPaise(v: unknown): boolean {
  return toPaise(v) === 0n;
}

export interface CashBookTotals {
  receiptCount: number;
  paymentCount: number;
  receiptTotal: bigint;
  paymentTotal: bigint;
}

export function cashBookTotals(entries: readonly CashBookLike[]): CashBookTotals {
  const t: CashBookTotals = { receiptCount: 0, paymentCount: 0, receiptTotal: 0n, paymentTotal: 0n };
  for (const e of entries) {
    const r = toPaise(e.receipt_minor);
    const p = toPaise(e.payment_minor);
    if (r > 0n) { t.receiptCount += 1; t.receiptTotal += r; }
    if (p > 0n) { t.paymentCount += 1; t.paymentTotal += p; }
  }
  return t;
}

/** Today's calendar date in India as YYYY-MM-DD (not UTC: 00:00-05:30 IST would be "yesterday"). */
export function todayIST(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * True when an entry date falls on the given IST calendar day. Accepts a bare
 * "YYYY-MM-DD" (taken as that calendar date) or a full ISO timestamp (converted
 * to its IST date), so the Today count no longer depends on the backend's format.
 */
export function isSameISTDate(value: unknown, istDay: string): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s === istDay;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === istDay;
}

export function countToday(entries: readonly CashBookLike[], istDay: string = todayIST()): number {
  return entries.filter((e) => isSameISTDate(e.entry_date, istDay)).length;
}

/**
 * Opening and closing balance of the listed window. The route returns rows
 * newest-first (ORDER BY entry_date DESC, created_at DESC), each carrying its
 * stored running balance: closing is the newest row's balance, opening is the
 * oldest row's balance before its own movement. Only meaningful for ONE account
 * type (cash or bank) and a window that is not truncated by the page limit, so
 * the caller passes `complete`; otherwise null.
 */
export function openingClosing(
  entries: readonly CashBookLike[],
  complete: boolean,
): { opening: bigint; closing: bigint } | null {
  if (!complete || entries.length === 0) return null;
  const newest = entries[0];
  const oldest = entries[entries.length - 1];
  return {
    closing: toPaise(newest.balance_minor),
    opening: toPaise(oldest.balance_minor) - toPaise(oldest.receipt_minor) + toPaise(oldest.payment_minor),
  };
}

/**
 * Value for a Receipt/Payment amount cell: null for the empty side of a row (the
 * amount cell then shows a dash instead of "\u20b90.00" and the CSV matches), the
 * original paise string otherwise. Balance columns are not passed through this,
 * so a genuine zero balance still reads \u20b90.00.
 */
export function sideAmountOrNull(v: unknown): string | null {
  return isZeroPaise(v) ? null : String(v);
}
