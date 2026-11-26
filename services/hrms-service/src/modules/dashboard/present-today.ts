/**
 * GAP-HR-DASHBOARD-07 (owner decision, 26 Nov 2026): the "Present Today" figure.
 *
 *   pct = round( presentEquivalent / (headcount - excluded) * 100 )
 *
 *   - present            counts 1
 *   - half_day           counts 0.5
 *   - approved WFH today counts as present (an employee with no attendance row
 *     but an approved WFH request covering today)
 *   - excluded from the DENOMINATOR (not counted against the rate): employees
 *     on approved leave (employee status on_leave, or an on_leave attendance
 *     row) and employees whose row says holiday. On a non-working day (a
 *     gazetted holiday, a weekly_off holiday row, or a weekend) an employee
 *     with no present/half_day/WFH record is excluded as well.
 *
 * Pure -- no DB, no clock -- so the rule is unit-tested on its own.
 */
export interface PresentTodayInput {
  /** Every non-separated (in-scope) employee, with today's attendance status when a row exists. */
  employees: { id: string; employeeStatus: string; attendanceStatus: string | null }[];
  /** Employees with an APPROVED WFH request covering today. */
  wfhEmployeeIds: string[];
  /** True when today is a gazetted holiday, a weekly_off day or a weekend. */
  nonWorkingDay: boolean;
}

export function computePresentTodayPct(input: PresentTodayInput): number {
  const wfh = new Set(input.wfhEmployeeIds);
  let weight = 0;
  let denominator = 0;
  for (const e of input.employees) {
    const att = e.attendanceStatus;
    let w = 0;
    if (att === "present") w = 1;
    else if (att === "half_day") w = 0.5;
    else if (wfh.has(e.id) && att !== "on_leave" && att !== "holiday") w = 1;
    const excluded =
      w === 0 && (
        e.employeeStatus === "on_leave" || att === "on_leave" || att === "holiday" || input.nonWorkingDay
      );
    if (excluded) continue;
    denominator += 1;
    weight += w;
  }
  return denominator > 0 ? Math.round((weight / denominator) * 100) : 0;
}
