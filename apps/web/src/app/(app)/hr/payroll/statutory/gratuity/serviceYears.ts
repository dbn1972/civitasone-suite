/**
 * GAP-PAYROLL-STATUTORY-GRATUITY-03 [HUMAN REVIEW: statutory calc]: Payment of
 * Gratuity Act 1972 s.4(2) -- in computing completed years of service, a
 * fraction of a year in EXCESS of six months counts as one full year (exactly
 * six months does not). The calculator used Math.floor(years), so 9 years 8
 * months was computed as 9. Eligibility (>= 5 years) is deliberately still
 * tested on the raw, un-rounded service: the "4 years 240 days" continuous-service
 * reading is not modelled here and the conservative reading is kept.
 */
export function completedServiceYears(years: number): number {
  if (!Number.isFinite(years) || years <= 0) return 0;
  const whole = Math.floor(years);
  // Round the fraction to 1e-6 to absorb float noise from decimal input
  // (e.g. 9.6667 - 9 = 0.6667000000000007).
  const fraction = Math.round((years - whole) * 1e6) / 1e6;
  return fraction > 0.5 ? whole + 1 : whole;
}
