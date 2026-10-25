/** Q33: due-date helpers for Log Observation. All calendar math is in IST (Asia/Kolkata), never the browser zone. */

/** Today's calendar date in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Error text for an invalid optional due date; null when empty or valid (today or later, IST). */
export function dueDateError(value: string, now: Date = new Date()): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Due date must be a valid date.";
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return "Due date must be a valid date.";
  if (v < todayIST(now)) return "Due date cannot be in the past.";
  return null;
}
