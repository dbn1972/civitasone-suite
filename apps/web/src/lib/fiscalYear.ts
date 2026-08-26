/**
 * Indian government fiscal year helpers. The FY runs 1 April → 31 March and is
 * labelled `YYYY-YY` (e.g. "2026-27"). Several finance endpoints
 * (budget-monitoring, revised-estimates, …) REQUIRE an `fy` query param and
 * return HTTP 400 without it, so screens must always resolve a concrete FY
 * rather than relying on a server-side default that does not exist.
 */

/** FY label ("2026-27") for the FY that contains `date`. */
export function financialYearOf(date: Date): string {
  // getMonth() is 0-based; March is 2, April is 3. On/after April we are in the
  // FY that starts in the current calendar year; before April, the previous one.
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** FY label for today (or an injected clock, for tests). */
export function currentFinancialYear(now: Date = new Date()): string {
  return financialYearOf(now);
}
