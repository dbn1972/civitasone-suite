/**
 * Serialise a datetime-local value ("YYYY-MM-DDTHH:mm", which carries no zone)
 * as an explicit IST instant, rather than new Date(x).toISOString() which
 * interprets it in the *browser's* timezone (GAP-ESTAB-GUESTHOUSE-NEW-05).
 * "2026-10-01T14:00" -> "2026-10-01T08:30:00.000Z" regardless of host TZ.
 */
export function istLocalToUtcIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  // Build the UTC instant for the given IST wall-clock time: subtract 5:30.
  const utcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi) - (5 * 60 + 30) * 60 * 1000;
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}
