/**
 * F&F service-length inputs derived from HR records. ONE definition shared by
 * the F&F calculator (fnf-route.ts) and the internal snapshot payroll-service
 * uses to verify a compute request (GAP-PAYROLL-FNF-03): the two must never
 * disagree on "completed years".
 */
import { effectiveBalanceDays } from "../leave/domain.js";

const MS_IN_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Completed years of service between joining and separation (365.25-day years, floored; never negative). */
export function completedYearsOfService(dateOfJoining: string | Date, separationDate: string | Date): number {
  const years = (new Date(separationDate).getTime() - new Date(dateOfJoining).getTime()) / MS_IN_YEAR;
  return Math.max(0, Math.floor(years));
}

/**
 * Total leave balance (days) across an employee's allocations, using the EXACT
 * half-day aware balance (balance_days_exact, 0.5 granularity) like leave
 * encashment and the payroll LOP read -- so a 12.5-day balance is 12.5, not 12.
 */
export function totalLeaveBalanceDays(
  allocations: ReadonlyArray<{ balanceDays: number | null; balanceDaysExact?: string | number | null }>,
): number {
  return allocations.reduce((sum, a) => sum + effectiveBalanceDays({ balanceDays: a.balanceDays ?? 0, balanceDaysExact: a.balanceDaysExact ?? null }), 0);
}
