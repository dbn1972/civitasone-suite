/**
 * Interview communications lifecycle (checklist R-RA-0142) — pure domain.
 *
 * Candidates are notified across the interview lifecycle: invite, reminder,
 * reschedule and cancel. Actual delivery is behind a feature flag: when enabled
 * the comm is queued to the transactional outbox for the notification service;
 * when disabled it is recorded as a STUB (no real send) — honestly marked, never
 * a fake "sent". No I/O here.
 */

export const INTERVIEW_COMM_TYPES = ["invite", "reminder", "reschedule", "cancel"] as const;
export type InterviewCommType = (typeof INTERVIEW_COMM_TYPES)[number];

export const COMM_CHANNELS = ["email", "sms", "stub"] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];

export type CommStatus = "queued" | "stubbed";

/** Whether real dispatch is enabled (feature flag). Defaults OFF (stub). */
export function commsEnabled(env: Record<string, string | undefined>): boolean {
  return env.FEATURE_INTERVIEW_COMMS_ENABLED === "true";
}

/**
 * Resolve how a comm is dispatched given the flag and requested channel. When
 * disabled, the channel is forced to "stub" and the status is "stubbed" (no send
 * happens); when enabled the requested channel is used and the comm is "queued"
 * for the outbox relay.
 */
export function resolveDispatch(enabled: boolean, requestedChannel: CommChannel | undefined): { channel: CommChannel; status: CommStatus } {
  if (!enabled) return { channel: "stub", status: "stubbed" };
  const channel: CommChannel = requestedChannel && requestedChannel !== "stub" ? requestedChannel : "email";
  return { channel, status: "queued" };
}

/** Candidate-facing message per comm type. Contains no internal/scoring data. */
export function buildCommMessage(type: InterviewCommType, ctx: { roundType?: string; scheduledDate?: string; scheduledTime?: string }): string {
  const when = ctx.scheduledDate ? ` on ${ctx.scheduledDate}${ctx.scheduledTime ? ` at ${ctx.scheduledTime}` : ""}` : "";
  switch (type) {
    case "invite": return `You are invited to an interview${when}. Please confirm your availability.`;
    case "reminder": return `Reminder: your interview is scheduled${when}.`;
    case "reschedule": return `Your interview has been rescheduled${when}.`;
    case "cancel": return "Your scheduled interview has been cancelled. We will contact you regarding next steps.";
  }
}

/** Reschedule requires a future-facing date + time; cancel/others do not. */
export function requiresSchedule(type: InterviewCommType): boolean {
  return type === "reschedule";
}

/** Interview states in which candidate communications may still be sent. */
export const COMMABLE_STATUSES = ["scheduled", "rescheduled"] as const;
export function canCommunicate(status: string): boolean {
  return (COMMABLE_STATUSES as readonly string[]).includes(status);
}

/** True only for a real calendar date in YYYY-MM-DD (rejects 2026-13-45 etc.). */
export function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True only for a real 24h time in HH:MM (rejects 25:99 etc.). */
export function isValidTime(s: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  const [h, min] = s.split(":").map(Number) as [number, number];
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}
