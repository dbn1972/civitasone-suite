/**
 * GAP-HR-WORKFORCE-STAFFING-PLAN-01: vacancy-threshold highlight carried over
 * from the retired /hr/workforce/staffing-plan copy. The 10% figure is the
 * platform default; it is a named constant so a tenant-level override is a
 * one-line change. The alert copy deliberately cites NO statutory rule
 * (product decision, 2026-10-03).
 *
 * Integer math (vacant * 100 > sanctioned * pct) so 10/100 is NOT over a 10%
 * threshold and floating point never decides a boundary.
 */
export const VACANCY_ALERT_THRESHOLD_PCT = 10;

export function isOverVacancyThreshold(
  vacant: number,
  sanctioned: number,
  thresholdPct: number = VACANCY_ALERT_THRESHOLD_PCT,
): boolean {
  if (!Number.isFinite(vacant) || !Number.isFinite(sanctioned)) return false;
  if (sanctioned <= 0 || vacant <= 0) return false;
  return vacant * 100 > sanctioned * thresholdPct;
}

export function countOverVacancyThreshold(
  rows: ReadonlyArray<{ vacant: number | string; sanctionedPosts: number | string }>,
  thresholdPct: number = VACANCY_ALERT_THRESHOLD_PCT,
): number {
  return rows.reduce(
    (n, r) => (isOverVacancyThreshold(Number(r.vacant), Number(r.sanctionedPosts), thresholdPct) ? n + 1 : n),
    0,
  );
}
