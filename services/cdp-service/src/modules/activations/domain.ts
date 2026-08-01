/**
 * activations/domain.ts — CDP-012 pure channel/status vocabulary and scheduling rule.
 */

/** Channels CDP can activate an audience to. `umang` is the GoI citizen app channel. */
export const ACTIVATION_CHANNELS = ["sms", "whatsapp", "push", "email", "umang"] as const;
export type ActivationChannel = (typeof ACTIVATION_CHANNELS)[number];

export const ACTIVATION_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

/**
 * A schedule in the past is treated as "send now" rather than rejected: clock skew
 * between a caller and the service is routine, and refusing the request would lose a
 * legitimate dispatch over a few seconds of drift.
 */
export function resolveDispatchAt(scheduledAt: string | undefined, now: Date): Date {
  if (scheduledAt === undefined) return now;
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) return now;
  return parsed.getTime() <= now.getTime() ? now : parsed;
}

/** True when the run should be dispatched immediately rather than parked for a scheduler. */
export function isImmediate(dispatchAt: Date, now: Date): boolean {
  return dispatchAt.getTime() <= now.getTime();
}
