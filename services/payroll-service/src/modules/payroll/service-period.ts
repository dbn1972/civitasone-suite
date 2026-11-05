import { rawComponentAmountMinor, type RawComponent } from "./domain.js";

/**
 * UAT L2-N5: which part of a pay period an employee is in service for.
 *
 * A run for month M pays only employees in service on at least one day of M:
 *  - joined AFTER the period end (DOJ > last day of M): not in the run at all.
 *    Before this, such an employee got a slip whose whole month was recovered
 *    as LOP on Basic + DA, while HRA was still paid in full (slip 5279948a).
 *  - left BEFORE the period start (date of leaving < 1st of M): not in the run.
 *  - joined / left inside M: paid pro rata for the days in service; the days
 *    not in service are recovered as loss of pay on every pay line that accrues
 *    by the day (see consumer.ts, processPayrollRun).
 *
 * Dates are YYYY-MM-DD (HRMS date columns). The date of leaving is the LAST
 * day in service (inclusive). A missing or malformed date of joining means
 * "in service from before the period" (the pre-L2-N5 behaviour); a missing
 * date of leaving means "still in service". Pure.
 */
export interface ServicePeriod {
  /** False: the employee is not in service on any day of the month and must not be in the run. */
  inService: boolean;
  /** Why the employee is excluded (only when inService is false). */
  reason?: "joined_after_period" | "left_before_period";
  daysInMonth: number;
  /** Calendar days of the month the employee is in service for (0..daysInMonth). */
  daysInService: number;
  /** daysInMonth - daysInService: the days before joining and after leaving. */
  daysNotInService: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function dayIndex(date: string | null | undefined): number | null {
  const m = date ? DATE.exec(date) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
}

export function servicePeriodInMonth(
  month: string,
  dateOfJoining: string | null | undefined,
  dateOfLeaving?: string | null,
): ServicePeriod {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const start = Date.UTC(year, mon - 1, 1) / 86_400_000;
  const end = start + daysInMonth - 1;
  const doj = dayIndex(dateOfJoining);
  const dol = dayIndex(dateOfLeaving);
  if (doj != null && doj > end) return { inService: false, reason: "joined_after_period", daysInMonth, daysInService: 0, daysNotInService: daysInMonth };
  if (dol != null && dol < start) return { inService: false, reason: "left_before_period", daysInMonth, daysInService: 0, daysNotInService: daysInMonth };
  const from = doj != null && doj > start ? doj : start;
  const to = dol != null && dol < end ? dol : end;
  if (to < from) return { inService: false, reason: "left_before_period", daysInMonth, daysInService: 0, daysNotInService: daysInMonth };
  const daysInService = to - from + 1;
  return { inService: true, daysInMonth, daysInService, daysNotInService: daysInMonth - daysInService };
}

/**
 * Structure (pay-structure) EARNING lines that accrue by the day and so fall
 * for the days NOT in service (before joining / after leaving): every
 * configured earning other than BASIC / DA / HRA (which the run prices itself),
 * at the amount computeSlip will pay (rawComponentAmountMinor). Leave LOP does
 * not reach them: payroll_components carries no LOP-applicable flag, so a
 * structure allowance (e.g. transport) is paid in full for days on leave.
 */
export function structureEarningsMinor(basicMinor: bigint, rawComponents: RawComponent[]): bigint {
  let total = 0n;
  for (const c of rawComponents) {
    if (c.type !== "earning" || ["BASIC", "DA", "HRA"].includes(c.code)) continue;
    total += rawComponentAmountMinor(basicMinor, c);
  }
  return total;
}
