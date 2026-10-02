/**
 * GAP-PAYROLL-SALARY-SLIPS-02 / -03: pure helpers for the salary-slips list.
 *
 * payroll-service lists slips as `payPeriod` display strings ("Aug 2026") and
 * only supports `limit` (max 500) -- no period filter, offset or aggregates yet.
 * So the page loads up to SLIPS_PAGE_LIMIT rows and (a) groups/filters by that
 * label, (b) only prints money totals when it KNOWS it holds every slip, and
 * (c) says so when it may not. A total over a silently truncated page is the
 * failure this closes.
 */
export const SLIPS_PAGE_LIMIT = 500; // listQuerySchema max
export const ALL_PERIODS = "all";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 2026" or "2026-08" -> 202608 (sortable); unparseable -> 0. */
export function periodSortKey(label: string): number {
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  if (iso) return Number(iso[1]) * 100 + Number(iso[2]);
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(label);
  if (m) {
    const idx = MONTHS.indexOf(m[1]);
    if (idx >= 0) return Number(m[2]) * 100 + idx + 1;
  }
  return 0;
}

/** Distinct periods, newest first. */
export function distinctPeriods(slips: ReadonlyArray<{ payPeriod: string }>): string[] {
  return [...new Set(slips.map((s) => s.payPeriod))].sort((a, b) => periodSortKey(b) - periodSortKey(a));
}

/** The requested period if present, "all" if asked, else the newest period (or "all" when there are none). */
export function resolvePeriod(requested: string | undefined, periods: readonly string[]): string {
  if (requested === ALL_PERIODS) return ALL_PERIODS;
  if (requested && periods.includes(requested)) return requested;
  return periods[0] ?? ALL_PERIODS;
}

export type SlipTotals = { count: number; grossMinor: bigint; netMinor: bigint };

export function sumSlips(slips: ReadonlyArray<{ gross: number; net: number }>): SlipTotals {
  let grossMinor = 0n;
  let netMinor = 0n;
  for (const s of slips) {
    grossMinor += BigInt(Math.round(Number(s.gross) || 0));
    netMinor += BigInt(Math.round(Number(s.net) || 0));
  }
  return { count: slips.length, grossMinor, netMinor };
}

/** True when the response may be cut off at the server's page size. */
export function mayBeTruncated(returned: number, limit: number = SLIPS_PAGE_LIMIT): boolean {
  return returned >= limit;
}
