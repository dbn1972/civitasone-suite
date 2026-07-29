/**
 * Maker-checker override of a screening decision (R-RA-0111) — pure domain.
 *
 * Government recruitment requires that overturning an automated/manual screening
 * outcome is a two-person control: one HR admin REQUESTS the override (with a
 * reason), a DIFFERENT admin approves it. Separation of duties (SoD): the
 * approver must not be the requester and must not be the person who made the
 * decision being overturned (the "content author"). No I/O here.
 */
import {
  SCREENING_DECISIONS, requiresRejectionReason,
  isRejectionReasonCode, type ScreeningDecision,
} from "./screening.js";

export const OVERRIDE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type OverrideStatus = (typeof OVERRIDE_STATUSES)[number];

export interface OverrideRequestInput {
  fromDecision: string;
  toDecision: string;
  reasonCode?: string | undefined;
  reason?: string | undefined;
}

/**
 * Validate an override REQUEST. Returns human-readable errors (empty = valid).
 * The target must be a real decision, must differ from the current one, must
 * carry a justification, and — when it rejects the candidate — a structured
 * rejection reason code.
 */
export function validateOverrideRequest(input: OverrideRequestInput): string[] {
  const errors: string[] = [];
  if (!(SCREENING_DECISIONS as readonly string[]).includes(input.toDecision)) {
    errors.push(`toDecision must be one of: ${SCREENING_DECISIONS.join(", ")}`);
  }
  if (input.toDecision === input.fromDecision) {
    errors.push("toDecision must differ from the current decision (nothing to override)");
  }
  if (input.fromDecision === "pending") {
    errors.push("a pending application has no decision to override — use the screening-decision endpoint");
  }
  if (input.toDecision === "pending") {
    errors.push("cannot override a decision back to 'pending'");
  }
  if (!input.reason || input.reason.trim().length === 0) {
    errors.push("an override reason is required");
  }
  if (
    (SCREENING_DECISIONS as readonly string[]).includes(input.toDecision) &&
    requiresRejectionReason(input.toDecision as ScreeningDecision) &&
    !(input.reasonCode && isRejectionReasonCode(input.reasonCode))
  ) {
    errors.push("a structured rejection reasonCode is required to override to 'ineligible'");
  }
  return errors;
}

export interface SodParties {
  requestedBy: string;
  originalScreenedBy?: string | null | undefined;
}

/**
 * Separation-of-duties gate for the APPROVER of an override. The approver may
 * not be the requester, nor the person who authored the decision being
 * overturned. Returns a reason string when the approver is disallowed, or null
 * when they may proceed.
 */
export function sodViolationForApprover(approverId: string, parties: SodParties): string | null {
  if (approverId === parties.requestedBy) {
    return "separation of duties: the approver cannot be the officer who requested the override";
  }
  if (parties.originalScreenedBy && approverId === parties.originalScreenedBy) {
    return "separation of duties: the approver cannot be the officer who made the original screening decision";
  }
  return null;
}

/** A request can only be acted on (approved/rejected/cancelled) while pending. */
export function isActionable(status: string): boolean {
  return status === "pending";
}
