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

/** The current Indian FY and the `count - 1` preceding ones, most-recent first. */
export function recentFinancialYears(count = 5, now: Date = new Date()): string[] {
  const currentStart = Number(currentFinancialYear(now).slice(0, 4));
  return Array.from({ length: count }, (_, i) => fiscalYearLabel(currentStart - i));
}
