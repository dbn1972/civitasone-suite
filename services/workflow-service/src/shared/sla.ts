/** Compute an absolute due timestamp from an SLA in minutes, or null if unset. */
export function computeDueAt(slaMinutes: number | null | undefined, from: Date = new Date()): Date | null {
  if (slaMinutes === null || slaMinutes === undefined || slaMinutes <= 0) return null;
  return new Date(from.getTime() + slaMinutes * 60_000);
}
