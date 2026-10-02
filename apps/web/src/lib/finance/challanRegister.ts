/**
 * Pure helpers for the finance challan register (list + detail).
 * GAP-FINANCE-REVENUE-CHALLANS-02/03, DETAIL-03.
 */

/**
 * treasury.finance_challans.status CHECK (migration 0036): pending | deposited |
 * reconciled. The page used to count a non-existent "verified" status, so the
 * Verified card was always 0 and every row landed in Pending.
 */
export interface ChallanStatusCounts {
  total: number;
  pending: number;
  deposited: number;
  reconciled: number;
  /** Any status outside the known enum, so the cards always sum to total. */
  other: number;
}

export function challanStatusCounts(rows: ReadonlyArray<{ status?: unknown }>): ChallanStatusCounts {
  const c: ChallanStatusCounts = { total: rows.length, pending: 0, deposited: 0, reconciled: 0, other: 0 };
  for (const r of rows) {
    const s = String(r.status ?? "").trim().toLowerCase();
    if (s === "pending") c.pending += 1;
    else if (s === "deposited") c.deposited += 1;
    else if (s === "reconciled") c.reconciled += 1;
    else c.other += 1;
  }
  return c;
}

/**
 * "0040 - Tax Revenue". Never falls back to the raw receipt_head_id uuid: with
 * only an id available the cell is a dash. A code or a name alone is shown as is.
 */
export function formatReceiptHead(code: string | null | undefined, name: string | null | undefined): string {
  const c = (code ?? "").trim();
  const n = (name ?? "").trim();
  if (c && n) return `${c} - ${n}`;
  return c || n || "\u2014";
}
