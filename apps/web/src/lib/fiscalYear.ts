/**
 * Indian government fiscal year helpers. The FY runs 1 April → 31 March and is
 * labelled `YYYY-YY` (e.g. "2026-27"). Several finance endpoints
 * (budget-monitoring, revised-estimates, …) REQUIRE an `fy` query param and
 * return HTTP 400 without it, so screens must always resolve a concrete FY
 * rather than relying on a server-side default that does not exist.
 *
 * The FY boundary is defined in India (Asia/Kolkata, UTC+05:30), NOT in the
 * process timezone. The web service and this host run UTC, so a naive
 * `new Date().getMonth()` would still read "March" for the first 5.5 hours of
 * 1 April IST (18:30–23:59 UTC on 31 March) and hand back the PREVIOUS FY —
 * showing last year's budget on the first morning of the new fiscal year. We
 * therefore read the year+month AS OBSERVED IN IST before the boundary test.
 */

/** Year and 1-based month of `date` as observed in Asia/Kolkata. */
function istYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value); // 1..12
  return { year, month };
}

/** FY label ("2026-27") for a fiscal year that STARTS in `startYear`. */
export function fiscalYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** FY label ("2026-27") for the Indian FY that contains `date`. */
export function financialYearOf(date: Date): string {
  const { year, month } = istYearMonth(date);
  // On/after April (month >= 4) we are in the FY that starts this calendar
  // year; before April, the FY that started the previous year.
  const startYear = month >= 4 ? year : year - 1;
  return fiscalYearLabel(startYear);
}

/** FY label for now (or an injected clock, for tests). */
export function currentFinancialYear(now: Date = new Date()): string {
  return financialYearOf(now);
}

/**
 * Calendar year-month label ("2026-08") for `date`, as observed in
 * Asia/Kolkata. For filing-period pickers (GST, TDS) that are scoped to a
 * calendar month rather than a fiscal year — same IST-boundary reasoning as
 * `financialYearOf` above: a naive `new Date().getMonth()` reads the wrong
 * month for the first 5.5 hours of each new IST day that falls on a UTC date
 * boundary.
 */
export function currentMonthPeriod(now: Date = new Date()): string {
  const { year, month } = istYearMonth(now);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The current Indian FY and the `count - 1` preceding ones, most-recent first. */
export function recentFinancialYears(count = 5, now: Date = new Date()): string[] {
  const currentStart = Number(currentFinancialYear(now).slice(0, 4));
  return Array.from({ length: count }, (_, i) => fiscalYearLabel(currentStart - i));
}

/**
 * True for a well-formed FY label whose second half is the year after the
 * first ("2026-27", "1999-00"); false for "2026-99", "2026-05", "2026/27".
 * GAP-PAYROLL-FLEX-BENEFITS-03 / BONUS-03: the forms' bare /^\d{4}-\d{2}$/
 * accepted any two digits after the dash.
 */
export function isValidFinancialYearLabel(fy: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!match) return false;
  return Number(match[2]) === (Number(match[1]) + 1) % 100;
}

export type FiscalYearRange = { code: string; startDate: string; endDate: string };

export type FiscalYearConflicts = {
  /** An existing year with the same code. */
  duplicateOf?: string;
  /** An existing year whose date range overlaps the new one (inclusive). */
  overlapsWith?: string;
  /** Days left uncovered between the latest existing year's end and the new start (> 0 = gap). */
  gapAfter?: { code: string; days: number };
};

const DAY_MS = 86_400_000;

/**
 * GAP-FINANCE-FISCAL-YEARS-01: overlap/gap check for a new fiscal year against
 * the existing ones. Overlap and duplicate block creation (finance-service
 * rejects them with 409 too); a gap after the latest year is only a warning
 * -- it can be legitimate when a tenant onboards mid-history. ISO date
 * strings compare chronologically.
 */
export function findFiscalYearConflicts(next: FiscalYearRange, rows: readonly FiscalYearRange[]): FiscalYearConflicts {
  const out: FiscalYearConflicts = {};
  for (const fy of rows) {
    if (fy.code === next.code) out.duplicateOf ??= fy.code;
    else if (fy.startDate && fy.endDate && next.startDate <= fy.endDate && fy.startDate <= next.endDate) {
      out.overlapsWith ??= fy.code;
    }
  }
  const before = rows
    .filter((fy) => fy.endDate && fy.endDate < next.startDate)
    .sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
  if (before) {
    const days = Math.round((Date.parse(`${next.startDate}T00:00:00Z`) - Date.parse(`${before.endDate}T00:00:00Z`)) / DAY_MS) - 1;
    if (days > 0) out.gapAfter = { code: before.code, days };
  }
  return out;
}
