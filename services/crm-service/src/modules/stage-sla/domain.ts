/**
 * G3 — Stage SLA pure domain logic.
 * All functions are pure (no IO), making them trivially testable.
 */

export interface SLAPolicy {
  slaHours: number;
  warnAtPercent: number;
}

/**
 * Compute the absolute deadline timestamp given a stage entry time and SLA hours.
 * Returns null if slaHours is non-positive (defensive).
 */
export function computeDeadline(enteredAt: Date, slaHours: number): Date | null {
  if (slaHours <= 0) return null;
  return new Date(enteredAt.getTime() + slaHours * 60 * 60 * 1000);
}

/**
 * Determine whether the SLA has been breached (elapsed time >= slaHours).
 */
export function isBreached(enteredAt: Date, now: Date, slaHours: number): boolean {
  if (slaHours <= 0) return false;
  const deadline = computeDeadline(enteredAt, slaHours);
  if (!deadline) return false;
  return now.getTime() >= deadline.getTime();
}

/**
 * Determine whether the current elapsed time has crossed the warning threshold
 * but has NOT yet breached. Returns true only in the warning window.
 *
 * Warning fires when: elapsed >= (slaHours * warnAtPercent / 100) AND NOT breached.
 */
export function isWarning(enteredAt: Date, now: Date, policy: SLAPolicy): boolean {
  const { slaHours, warnAtPercent } = policy;
  if (slaHours <= 0 || warnAtPercent <= 0 || warnAtPercent >= 100) return false;

  const elapsed = now.getTime() - enteredAt.getTime();
  const totalMs = slaHours * 60 * 60 * 1000;
  const warnMs = (totalMs * warnAtPercent) / 100;

  return elapsed >= warnMs && elapsed < totalMs;
}

/**
 * Compute the percentage of SLA time that has elapsed.
 * Clamps at 0 minimum (no negative progress) but can exceed 100 when breached.
 */
export function elapsedPercent(enteredAt: Date, now: Date, slaHours: number): number {
  if (slaHours <= 0) return 0;
  const elapsed = now.getTime() - enteredAt.getTime();
  const totalMs = slaHours * 60 * 60 * 1000;
  return Math.max(0, (elapsed / totalMs) * 100);
}
