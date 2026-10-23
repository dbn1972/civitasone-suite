/**
 * Last calendar day of a "YYYY-MM" utilisation period, as YYYY-MM-DD (28/29/30/31).
 * The read model used to fabricate every period end as the 28th. An unparseable
 * period falls back to the 28th, the one day every month has.
 */
export function periodEnd(period: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(period);
  if (!m) return `${period}-28`;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return `${period}-28`;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(day).padStart(2, "0")}`;
}
