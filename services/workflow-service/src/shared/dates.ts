/**
 * Calendar-date helpers pinned to India Standard Time (Asia/Kolkata, UTC+05:30).
 * Delegation validity is a calendar-date concept shared with the web UI, which
 * renders dates in IST; using the UTC date makes the two disagree between
 * 00:00 and 05:30 IST.
 */
const IST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

/** The IST calendar date (YYYY-MM-DD) of the given instant. */
export function istDateKey(now: Date = new Date()): string {
  return IST_DATE.format(now);
}

/** Today in IST as YYYY-MM-DD. */
export function todayIST(): string {
  return istDateKey(new Date());
}
