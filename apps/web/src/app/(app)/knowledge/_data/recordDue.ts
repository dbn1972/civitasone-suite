/**
 * Shared helpers for record retention due-date calculations.
 *
 * GAP-KNOWLEDGE-RECORDS-02 / GAP-KNOWLEDGE-RECORDS-07
 *
 * All date arithmetic is done in IST (Asia/Kolkata) to match what Indian
 * government users expect — the server may run in UTC but the 30-day
 * window boundary should align with the calendar date in India.
 */

const IST_TZ = "Asia/Kolkata";

/** Return today's date string in IST as YYYY-MM-DD. */
export function todayInIST(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: IST_TZ }); // en-CA → YYYY-MM-DD
}

/** Return the date 30 days from today in IST as YYYY-MM-DD. */
export function thirtyDaysFromNowIST(now: Date = new Date()): string {
  // Parse today's IST date, add 30 days
  const todayStr = todayInIST(now);
  const [y, m, d] = todayStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

type RecordLike = {
  status: string;
  disposalDueDate?: string | null;
};

/**
 * A record is "review due" when it is active and its disposal due date falls
 * within the next 30 calendar days (IST).
 *
 * This powers the "Due Review" KPI.
 */
export function isReviewDue(rec: RecordLike, now: Date = new Date()): boolean {
  if (rec.status !== "active") return false;
  if (!rec.disposalDueDate) return false;
  const cutoff = thirtyDaysFromNowIST(now);
  // disposal due <= 30 days from now (string comparison of YYYY-MM-DD is safe)
  return rec.disposalDueDate <= cutoff;
}

/**
 * A record is "overdue for weeding" when it is active and its disposal due
 * date has already passed (IST today).
 *
 * This powers the "Weeding Due" KPI.  Previously weeding-due was defined as
 * status === 'disposed', which is semantically wrong — a disposed record has
 * already been destroyed.
 */
export function isWeedingDue(rec: RecordLike, now: Date = new Date()): boolean {
  if (rec.status !== "active") return false;
  if (!rec.disposalDueDate) return false;
  const today = todayInIST(now);
  return rec.disposalDueDate < today;
}

export type DueKind = "none" | "review" | "weeding";

/**
 * Classify a record as weeding-due (overdue), review-due (within 30d window),
 * or none — for use in both KPIs and the table segment.
 */
export function dueKind(rec: RecordLike, now: Date = new Date()): DueKind {
  if (isWeedingDue(rec, now)) return "weeding";
  if (isReviewDue(rec, now)) return "review";
  return "none";
}
