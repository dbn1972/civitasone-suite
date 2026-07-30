/**
 * Candidate interview self-service — confirm / request reschedule (R-RA-0143) — pure.
 *
 * A candidate can CONFIRM attendance of a scheduled interview, or REQUEST a
 * reschedule (proposing a preferred slot + reason). A reschedule request is a
 * pending record that HR then APPROVES (applying the new slot) or DECLINES.
 *
 * AUTH DEFERRAL (honest note): candidate-facing authentication is not yet wired
 * in this service (there is no candidate identity/role). Until a candidate-scoped
 * token exists, these endpoints are HR-gated — HR records the candidate's
 * response on their behalf. The durable request record + HR approve/decline
 * workflow is the real mechanism and does not change when candidate auth lands.
 */
import { isValidCalendarDate, isValidTime } from "./interview-comms.js";

export const RESPONSE_TYPES = ["confirm", "reschedule_request"] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

export const RESPONSE_STATUSES = ["confirmed", "pending", "approved", "declined"] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

export interface ResponseInput {
  type: ResponseType;
  preferredDate?: string | undefined;
  preferredTime?: string | undefined;
  reason?: string | undefined;
}

/** True when YYYY-MM-DD + HH:MM (interpreted as UTC) is strictly after nowMs. */
export function isFutureSlot(date: string, time: string, nowMs: number): boolean {
  const t = Date.parse(`${date}T${time}:00Z`);
  return Number.isFinite(t) && t > nowMs;
}

/**
 * Validate a candidate response. Returns human-readable errors (empty = valid).
 * A reschedule request needs a real, FUTURE preferred slot and a reason so it
 * can never move an interview into the past.
 */
export function validateResponse(input: ResponseInput, nowMs: number = Date.now()): string[] {
  const errors: string[] = [];
  if (input.type === "reschedule_request") {
    if (!input.preferredDate || !input.preferredTime) {
      errors.push("a reschedule request requires preferredDate and preferredTime");
    } else if (!isValidCalendarDate(input.preferredDate)) {
      errors.push("preferredDate must be a valid YYYY-MM-DD date");
    } else if (!isValidTime(input.preferredTime)) {
      errors.push("preferredTime must be a valid HH:MM time");
    } else if (!isFutureSlot(input.preferredDate, input.preferredTime, nowMs)) {
      errors.push("the preferred slot must be in the future");
    }
    if (!input.reason || input.reason.trim().length === 0) errors.push("a reschedule request requires a reason");
  }
  return errors;
}

/** The status a freshly-recorded response starts in. */
export function initialStatus(type: ResponseType): ResponseStatus {
  return type === "confirm" ? "confirmed" : "pending";
}

/** Only a pending reschedule request can be approved/declined by HR. */
export function isDecidable(status: string): boolean {
  return status === "pending";
}
