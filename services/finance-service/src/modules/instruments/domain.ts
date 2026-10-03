/**
 * Pure cheque-validity rules (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04).
 *
 * RBI: a cheque is valid for THREE months from the date of the instrument; after that it is stale
 * and the bank returns it unpaid. The horizon is a per-tenant policy value (finance_policy
 * .cheque_validity_months, default 3) so a tenant under a different instruction can change it.
 */

/** ISO date (YYYY-MM-DD) plus N calendar months; the day is clamped to the target month's last day. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = (m - 1) + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, last);
  return `${String(ty).padStart(4, "0")}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

/** The last day the instrument is still valid (inclusive). */
export function validUntil(issueDate: string, validityMonths: number): string {
  return addMonthsIso(issueDate, validityMonths);
}

/** True once today is strictly after the last valid day. `today` is an ISO date (UTC). */
export function isStale(issueDate: string, validityMonths: number, today: string): boolean {
  return today > validUntil(issueDate, validityMonths);
}

/** Today's date in India (Asia/Kolkata, UTC+05:30, no DST): the validity horizon is a calendar-day rule in IST. */
export function todayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
