/**
 * Execution domain — pure functions for inspection lifecycle state management.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: 8.1, 8.3, 8.4, 8.7_
 */

import {
  validateCompletion as validateChecklistCompletion,
  type ChecklistSection,
  type ResponseEntry,
  type CompletionResult,
} from "../checklist/domain.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** All valid inspection lifecycle states. */
export const INSPECTION_STATES = [
  "scheduled",
  "in_progress",
  "paused",
  "completed",
  "under_review",
  "finalized",
] as const;
export type InspectionState = (typeof INSPECTION_STATES)[number];

// ── State Machine ─────────────────────────────────────────────────────────────

/**
 * Defines allowed transitions for each inspection state.
 *
 * Graph:
 *   scheduled     → in_progress
 *   in_progress   → paused, completed
 *   paused        → in_progress
 *   completed     → under_review
 *   under_review  → finalized, in_progress (return for revision)
 *   finalized     → (terminal)
 *
 * _Validates: Requirement 8.1, 8.7_
 */
export const INSPECTION_TRANSITIONS: Record<InspectionState, InspectionState[]> = {
  scheduled: ["in_progress"],
  in_progress: ["paused", "completed"],
  paused: ["in_progress"],
  completed: ["under_review"],
  under_review: ["finalized", "in_progress"],
  finalized: [],
};

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for inspection execution logic violations.
 * Kept separate from HttpError to maintain pure domain boundary.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Assert that a state transition is valid per the inspection lifecycle state machine.
 *
 * @param current - The current inspection state.
 * @param target - The desired target state.
 * @throws {DomainError} with code `INVALID_TRANSITION` if the transition is not allowed.
 *
 * _Validates: Requirement 8.1, 8.7_
 */
export function assertValidTransition(current: InspectionState, target: InspectionState): void {
  const allowed = INSPECTION_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition from '${current}' to '${target}'. Allowed: ${allowed.join(", ")}`,
    );
  }
}

/**
 * Validate that an inspection is complete and ready for submission.
 *
 * Completion requires:
 * 1. All mandatory checklist questions across all sections have responses.
 * 2. Evidence count meets or exceeds the required minimum.
 *
 * Delegates to `checklist/domain.validateCompletion` for the actual checks.
 *
 * @param sections - The checklist sections with questions.
 * @param responses - Map of questionId → { value, answeredAt }.
 * @param evidenceCount - Number of evidence artifacts attached.
 * @param requiredEvidenceCount - Minimum required evidence artifacts.
 * @returns Object with `valid` boolean and `missing` array listing what's missing.
 *
 * _Validates: Requirement 8.3, 8.4_
 */
export function validateCompletion(
  sections: ChecklistSection[],
  responses: Record<string, ResponseEntry>,
  evidenceCount: number,
  requiredEvidenceCount: number,
): CompletionResult {
  return validateChecklistCompletion(sections, responses, evidenceCount, requiredEvidenceCount);
}
