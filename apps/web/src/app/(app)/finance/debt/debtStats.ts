import type { FinanceDebtSummary } from "@civitasone/types";

/**
 * GAP-FINANCE-DEBT-02 / -03: the debt register's stat cards, derived from the
 * rows the table shows. Money is bigint paise (amountMinor arrives as a
 * decimal string); an unparseable amount counts as 0 rather than throwing.
 */
export function summariseDebt(rows: (Pick<FinanceDebtSummary, "status" | "amountMinor"> & { currency?: string })[]): {
  total: number;
  active: number;
  closed: number;
  totalMinor: bigint;
  /** True only when every row is INR; a total across currencies is meaningless. */
  allInr: boolean;
} {
  let active = 0;
  let closed = 0;
  let totalMinor = 0n;
  let allInr = true;
  for (const r of rows) {
    const s = String(r.status).toLowerCase();
    if (s === "active") active += 1;
    else if (s === "closed") closed += 1;
    if ((r.currency ?? "INR").trim().toUpperCase() !== "INR") allInr = false;
    const a = String(r.amountMinor ?? "").trim();
    if (/^-?\d+$/.test(a)) totalMinor += BigInt(a);
  }
  return { total: rows.length, active, closed, totalMinor, allInr };
}
