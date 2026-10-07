/**
 * GAP-PROCUREMENT-PLANNING-NEW-01: the Indian financial year runs 1 April –
 * 31 March. A plan's `planYear` is stored as the START year (FY 2026-27 ->
 * 2026). These helpers compute and label the FY so the New Plan form stops
 * defaulting (via `new Date().getFullYear() + 1`) to the wrong year in
 * Jan–Mar, and so the list / detail / form all render the FY label from one
 * source of truth.
 */

const IST_TIME_ZONE = "Asia/Kolkata";

/**
 * The START year of the Indian financial year that `d` falls in, evaluated in
 * Asia/Kolkata. April (month index 3) onwards belongs to the FY that starts
 * this calendar year; Jan–Mar belongs to the FY that started last year.
 *
 *   currentFinancialYearStart(new Date("2027-02-10T00:00:00+05:30")) -> 2026
 *   currentFinancialYearStart(new Date("2026-09-29T00:00:00+05:30")) -> 2026
 *   currentFinancialYearStart(new Date("2027-04-01T00:00:00+05:30")) -> 2027
 */
export function currentFinancialYearStart(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value); // 1-12
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    // Fall back to the raw UTC calendar if Intl is unavailable for any reason.
    const uy = d.getUTCFullYear();
    const um = d.getUTCMonth() + 1;
    return um >= 4 ? uy : uy - 1;
  }
  return month >= 4 ? year : year - 1;
}

/**
 * "FY 2026-27" from the FY START year (2026). Pads the end year to two
 * digits, matching how the plans list and detail pages already render it.
 *
 *   fyLabel(2026) -> "FY 2026-27"
 *   fyLabel(2099) -> "FY 2099-00"
 */
export function fyLabel(startYear: number): string {
  const end = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `FY ${startYear}-${end}`;
}
