/**
 * feedback/domain.ts — Pure validation for recommendation feedback.
 *
 * Business rule: a rejection must always carry a reason. Rejection reasons are
 * the only negative training signal available to the recommendation model, so
 * an unexplained rejection is treated as invalid input rather than persisted.
 */

export type FeedbackAction = "accepted" | "rejected";

export const FEEDBACK_ACTIONS: readonly FeedbackAction[] = ["accepted", "rejected"];

/** Longest accepted reason — matches varchar(500) in the schema. */
export const MAX_REASON_LENGTH = 500;

export interface FeedbackInput {
  action: string;
  reason?: string | null;
}

export function isFeedbackAction(value: string): value is FeedbackAction {
  return (FEEDBACK_ACTIONS as readonly string[]).includes(value);
}

/**
 * Validate feedback. Returns null when valid, otherwise a human message
 * suitable for a 422 response.
 */
export function validateFeedback(input: FeedbackInput): string | null {
  if (typeof input.action !== "string" || !isFeedbackAction(input.action)) {
    return `unknown feedback action: ${String(input.action)}`;
  }

  const reason = input.reason;
  const trimmed = typeof reason === "string" ? reason.trim() : "";

  if (input.action === "rejected" && trimmed.length === 0) {
    return "reason is required when rejecting a recommendation";
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    return `reason must not exceed ${MAX_REASON_LENGTH} characters`;
  }

  return null;
}

/**
 * True when the action closes the recommendation lifecycle. Both accept and
 * reject are terminal today; kept as a function so future non-terminal actions
 * (for example "snoozed") only need a change here.
 */
export function isTerminalAction(action: string): boolean {
  return isFeedbackAction(action);
}

/** Normalise a reason for storage: trimmed, or null when absent/blank. */
export function normaliseReason(reason?: string | null): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed.length === 0 ? null : trimmed;
}
