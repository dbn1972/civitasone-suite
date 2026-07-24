/**
 * Scheduling domain logic — pure functions for schedule validation.
 */

/** Returns true if scheduledAt is in the future relative to now. */
export function validateScheduledAt(scheduledAt: string, now: Date = new Date()): boolean {
  const target = new Date(scheduledAt);
  if (isNaN(target.getTime())) return false;
  return target.getTime() > now.getTime();
}

/** Returns true if scheduledAt is due (i.e. scheduledAt <= now). */
export function isScheduleDue(scheduledAt: string, now: Date = new Date()): boolean {
  const target = new Date(scheduledAt);
  if (isNaN(target.getTime())) return false;
  return target.getTime() <= now.getTime();
}
