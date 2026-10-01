/**
 * GAP-PAYROLL-STATUTORY-PERQUISITE-05: shared Indian financial-year format
 * validator, extracted from returns/page.tsx's own FY_RE (the only other
 * place in this slice that already validated the format, vs. several forms
 * here that accepted any non-empty string). Mirrors payroll-service's own
 * parseFy() (tax/routes.ts / tax/form16.ts): format YYYY-YY AND the second
 * component must equal (startYear + 1) % 100 -- e.g. "2026-27" is valid,
 * "2026-28"/"2026-2027"/"26-27" are not. Catches a typo'd FY before it is
 * sent to the backend (which would otherwise 400 only after the round trip,
 * or -- for endpoints with a looser query-param check -- silently return
 * "no data" for the mistyped year).
 */
export const FY_RE = /^\d{4}-\d{2}$/;

export function isValidFy(fy: string): boolean {
  const m = FY_RE.exec(fy);
  if (!m) return false;
  const startYear = Number(fy.slice(0, 4));
  const suffix = Number(fy.slice(5, 7));
  return suffix === (startYear + 1) % 100;
}
