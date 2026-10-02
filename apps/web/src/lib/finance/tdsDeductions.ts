import { maskPan } from "@/app/_components/ds/Masked";

/**
 * Pure helpers for the vendor TDS deduction register
 * (/finance/statutory/tds-returns). GAP-FINANCE-STATUTORY-TDS-RETURNS-01/02/04/05.
 */

/** gl.finance_vendor_tds.status: deducted -> deposited -> filed (finance-service tds routes). */
export interface TdsStatusCounts {
  total: number;
  deducted: number;
  deposited: number;
  filed: number;
  other: number;
}

export function tdsStatusCounts(rows: ReadonlyArray<{ status?: unknown }>): TdsStatusCounts {
  const c: TdsStatusCounts = { total: rows.length, deducted: 0, deposited: 0, filed: 0, other: 0 };
  for (const r of rows) {
    const s = String(r.status ?? "").trim().toLowerCase();
    if (s === "deducted") c.deducted += 1;
    else if (s === "deposited") c.deposited += 1;
    else if (s === "filed") c.filed += 1;
    else c.other += 1;
  }
  return c;
}

/** Distinct financial-year + quarter pairs; rows with no quarter or FY are skipped. */
export function fyQuarterCount(rows: ReadonlyArray<{ fy?: unknown; quarter?: unknown }>): number {
  const seen = new Set<string>();
  for (const r of rows) {
    const q = String(r.quarter ?? "").trim();
    const fy = String(r.fy ?? "").trim();
    if (!q || !fy) continue;
    seen.add(`${fy}|${q}`);
  }
  return seen.size;
}

/**
 * Replace the PAN with its masked form (ABCDE****F) before the rows reach the
 * client table, so the full PAN is never in the DOM, the offline cache or the
 * CSV export. A null/empty PAN stays null. Display-only: there is no reveal
 * (an audited reveal endpoint does not exist).
 */
export function maskTdsPan<T extends { pan?: string | null }>(rows: readonly T[]): T[] {
  return rows.map((r) => ({ ...r, pan: r.pan ? maskPan(r.pan) : null }));
}
