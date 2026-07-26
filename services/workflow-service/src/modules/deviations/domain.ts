/**
 * CAP-039 — deviation / waiver lifecycle (pure domain).
 *
 * A deviation is a request to depart from a standard process/rule against some
 * entity. It is raised (pending), then approved or rejected under maker-checker
 * (the reviewer must not be the requester), may carry an expiry, and an active
 * (approved, unexpired) waiver can be revoked. This module holds only the
 * transition guards; persistence and audit are the caller's.
 */

export type DeviationStatus = "pending" | "approved" | "rejected" | "expired" | "revoked";

export interface DeviationState {
  status: DeviationStatus;
  requestedBy: string;
  expiresAt: string | null;
}

export interface GuardResult {
  allowed: boolean;
  errors: string[];
}

/** Validate a raise request: a non-empty reason is mandatory. */
export function validateRaise(reason: string | null | undefined): GuardResult {
  const errors: string[] = [];
  if (!reason || reason.trim().length === 0) errors.push("REASON_REQUIRED");
  return { allowed: errors.length === 0, errors };
}

/**
 * Decide whether `reviewerId` may approve/reject the deviation. Enforces
 * maker-checker: only a PENDING request can be reviewed and the reviewer must
 * differ from the requester.
 */
export function canReview(state: DeviationState, reviewerId: string): GuardResult {
  const errors: string[] = [];
  if (state.status !== "pending") errors.push("NOT_PENDING");
  if (state.requestedBy === reviewerId) errors.push("MAKER_CHECKER_VIOLATION");
  return { allowed: errors.length === 0, errors };
}

/** Only an approved (and not already expired/revoked) deviation may be revoked. */
export function canRevoke(state: DeviationState): GuardResult {
  const errors: string[] = [];
  if (state.status !== "approved") errors.push("NOT_APPROVED");
  return { allowed: errors.length === 0, errors };
}

/**
 * An approved deviation is only *active* while unexpired. Anything else (pending,
 * rejected, revoked, or approved-but-past-expiry) is inactive.
 */
export function isActive(state: DeviationState, now: Date = new Date()): boolean {
  if (state.status !== "approved") return false;
  if (state.expiresAt && new Date(state.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

/** True when an approved deviation has passed its expiry and should lapse. */
export function hasLapsed(state: DeviationState, now: Date = new Date()): boolean {
  return state.status === "approved" && !!state.expiresAt && new Date(state.expiresAt).getTime() <= now.getTime();
}

/** The status a review decision maps to. */
export function decisionStatus(decision: "approve" | "reject"): DeviationStatus {
  return decision === "approve" ? "approved" : "rejected";
}
