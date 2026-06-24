/**
 * Scheduler engine — pure date computation. No DB, no I/O.
 *
 * Produces due-date computations for the periodic worker tick:
 *  - Superannuation (retirement on attaining the superannuation age, default 60
 *    under FR 56(a) / CCS rules) computed from date of birth. The superannuation
 *    date is the LAST day of the month in which the employee attains the
 *    superannuation age (CCS convention: retire on the afternoon of the last day
 *    of the month). Those born on the 1st retire on the last day of the
 *    PREVIOUS month — i.e. they attain age exactly on their birthday; the
 *    last-day-of-month rule still applies to the month preceding their birth
 *    month in that special case.
 *  - Probation-end due date = confirmation_date if recorded, else
 *    date_of_joining + probationMonths (default 24 months / 2 years).
 *
 * `daysBetween` returns whole days from `fromISO` to `toISO`.
 */

export const DEFAULT_SUPERANNUATION_AGE = 60;
export const DEFAULT_PROBATION_MONTHS = 24;

/** Whole days from fromISO to toISO (toISO - fromISO), can be negative. */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(
    Number(fromISO.slice(0, 4)), Number(fromISO.slice(5, 7)) - 1, Number(fromISO.slice(8, 10)));
  const b = Date.UTC(
    Number(toISO.slice(0, 4)), Number(toISO.slice(5, 7)) - 1, Number(toISO.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/** Last day (ISO date) of the month containing yyyy-mm. */
function lastDayOfMonth(year: number, month1: number): string {
  // month1 is 1-based. Day 0 of next month = last day of this month.
  const d = new Date(Date.UTC(year, month1, 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Superannuation date (ISO) for a date of birth at the given retirement age.
 * Returns the last day of the month in which the employee attains that age,
 * except when born on the 1st of a month — then they retire on the last day of
 * the previous month (CCS / FR 56 convention).
 */
export function superannuationDate(dateOfBirthISO: string, age = DEFAULT_SUPERANNUATION_AGE): string {
  const y = Number(dateOfBirthISO.slice(0, 4));
  const m = Number(dateOfBirthISO.slice(5, 7)); // 1-based
  const d = Number(dateOfBirthISO.slice(8, 10));
  const retireYear = y + age;
  if (d === 1) {
    // Born on the 1st: retire on the last day of the PREVIOUS month.
    const prevMonth = m - 1;
    if (prevMonth === 0) return lastDayOfMonth(retireYear - 1, 12);
    return lastDayOfMonth(retireYear, prevMonth);
  }
  return lastDayOfMonth(retireYear, m);
}

/** Add whole months to an ISO date, clamping the day to the target month length. */
export function addMonths(dateISO: string, months: number): string {
  const y = Number(dateISO.slice(0, 4));
  const m = Number(dateISO.slice(5, 7)); // 1-based
  const d = Number(dateISO.slice(8, 10));
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = base.getUTCFullYear();
  const tm = base.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ty}-${String(tm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface SuperannuationCandidate {
  employeeId: string;
  employeeNo: string | null;
  fullName: string | null;
  dateOfBirthISO: string;
}

export interface DueRow {
  employeeId: string;
  employeeNo: string | null;
  fullName: string | null;
  dueDateISO: string;
  daysRemaining: number;
  details: Record<string, unknown>;
}

/**
 * Filter candidates to those whose superannuation falls within
 * [asOfISO, asOfISO + withinDays]. Already-passed dates within the window
 * (negative days, e.g. overdue) are also included so HR can action overdue
 * cases; the caller decides how to treat negatives.
 */
export function computeSuperannuationDue(
  candidates: readonly SuperannuationCandidate[],
  asOfISO: string,
  withinDays: number,
  age = DEFAULT_SUPERANNUATION_AGE,
): DueRow[] {
  const out: DueRow[] = [];
  for (const c of candidates) {
    const dueDate = superannuationDate(c.dateOfBirthISO, age);
    const days = daysBetween(asOfISO, dueDate);
    if (days <= withinDays) {
      out.push({
        employeeId: c.employeeId,
        employeeNo: c.employeeNo,
        fullName: c.fullName,
        dueDateISO: dueDate,
        daysRemaining: days,
        details: { dateOfBirth: c.dateOfBirthISO, superannuationAge: age, kind: "superannuation" },
      });
    }
  }
  out.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return out;
}

export interface ProbationCandidate {
  employeeId: string;
  employeeNo: string | null;
  fullName: string | null;
  status: string;
  dateOfJoiningISO: string;
  confirmationDateISO: string | null;
}

/**
 * Probation-due list: employees still on probation whose probation-end date
 * (confirmation_date if set, else DOJ + probationMonths) is within the window.
 */
export function computeProbationDue(
  candidates: readonly ProbationCandidate[],
  asOfISO: string,
  withinDays: number,
  probationMonths = DEFAULT_PROBATION_MONTHS,
): DueRow[] {
  const out: DueRow[] = [];
  for (const c of candidates) {
    if (c.status !== "probation") continue;
    const endISO = c.confirmationDateISO ?? addMonths(c.dateOfJoiningISO, probationMonths);
    const days = daysBetween(asOfISO, endISO);
    if (days <= withinDays) {
      out.push({
        employeeId: c.employeeId,
        employeeNo: c.employeeNo,
        fullName: c.fullName,
        dueDateISO: endISO,
        daysRemaining: days,
        details: {
          dateOfJoining: c.dateOfJoiningISO,
          probationMonths,
          source: c.confirmationDateISO ? "confirmation_date" : "doj_plus_months",
          kind: "probation",
        },
      });
    }
  }
  out.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return out;
}
