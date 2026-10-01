/**
 * Shared payroll period / financial-year validation (GAP-PAYROLL-COMPARISON-01,
 * GAP-PAYROLL-COSTING-06, GAP-PAYROLL-REGISTER-03, GAP-PAYROLL-RETURNS-07).
 *
 * The pages in this cluster used to test `/^\d{4}-\d{2}$/`, which accepts
 * month 00 and 13-99 ("2026-13" passed and was sent to payroll-service),
 * and silently fell back to an empty state or a default when a typed value
 * failed. These helpers give every page the same strict rule and a way to
 * tell "nothing entered" apart from "entered but malformed".
 */

/** A pay period: `YYYY-MM` with a real calendar month (01-12). */
export const PERIOD_PATTERN = "\\d{4}-(0[1-9]|1[0-2])";
const PERIOD_RE = new RegExp(`^${PERIOD_PATTERN}$`);

export function isValidPeriod(value: string | null | undefined): boolean {
  return typeof value === "string" && PERIOD_RE.test(value.trim());
}

export type PeriodParam =
  | { state: "empty" }
  | { state: "valid"; period: string }
  | { state: "invalid"; raw: string };

/** Classify a raw `?period=` search param without throwing it away. */
export function parsePeriodParam(raw: string | null | undefined): PeriodParam {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { state: "empty" };
  return isValidPeriod(trimmed) ? { state: "valid", period: trimmed } : { state: "invalid", raw: trimmed };
}

/**
 * Indian financial year label `YYYY-YY` where the suffix is the following
 * year (2025-26). `2025-99` or `2025-25` are not real financial years.
 */
export function isValidFinancialYear(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const start = Number(m[1]);
  return Number(m[2]) === (start + 1) % 100;
}
