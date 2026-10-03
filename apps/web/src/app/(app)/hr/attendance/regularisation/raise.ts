/** Pure helpers for the "Raise request" form (GAP-HR-ATTENDANCE-REGULARISATION-01). */

export interface RegularisationFormValues {
  employeeId: string | null;
  date: string;
  requestedStatus: "present" | "absent" | "half_day";
  reason: string;
}

/** IST calendar date (YYYY-MM-DD): the attendance register's day, not the browser's. */
export function istToday(now: number = Date.now()): string {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Mirrors the server's regularisationCreateBody: a real date that is not in
 * the future, a non-empty reason, and (only when the caller picks one) an
 * employee. Returns field -> error key; empty means valid.
 */
export function validateRegularisationForm(
  v: RegularisationFormValues,
  opts: { needEmployee: boolean; today: string },
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (opts.needEmployee && !v.employeeId) errs.employee = "required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || v.date > opts.today) errs.date = "invalid";
  if (!v.reason.trim()) errs.reason = "required";
  return errs;
}

/** Plain-language message for the backend codes a user can act on; null = fall back to the generic one. */
export function friendlyRegularisationError(
  code: string | null,
  msgs: { noRecord: string; locked: string; notYourReport: string },
): string | null {
  switch (code) {
    case "ATTENDANCE_RECORD_NOT_FOUND": return msgs.noRecord;
    case "ATTENDANCE_LOCKED": return msgs.locked;
    case "NOT_YOUR_REPORT": return msgs.notYourReport;
    default: return null;
  }
}
