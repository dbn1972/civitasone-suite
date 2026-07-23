/**
 * CAPA domain — pure functions for CAPA lifecycle, validation, and state transitions.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: SVC-106_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Valid CAPA types. */
export const CAPA_TYPES = ["corrective", "preventive"] as const;
export type CapaType = typeof CAPA_TYPES[number];

/** Valid CAPA lifecycle states. */
export const CAPA_STATES = ["open", "in_progress", "completed", "verified", "overdue"] as const;
export type CapaState = typeof CAPA_STATES[number];

/** Permitted state transitions for CAPAs. */
export const CAPA_TRANSITIONS: Record<CapaState, CapaState[]> = {
  open:        ["in_progress", "overdue"],
  in_progress: ["completed", "overdue"],
  completed:   ["verified"],
  verified:    [],
  overdue:     ["in_progress", "completed"],
};

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for CAPA validation failures.
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
 * Assert that a CAPA state transition is valid.
 *
 * @param current - The current state of the CAPA.
 * @param target - The desired target state.
 * @throws {DomainError} with code `INVALID_TRANSITION` if the transition is not permitted.
 */
export function assertValidCapaTransition(current: CapaState, target: CapaState): void {
  const allowed = CAPA_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition CAPA from '${current}' to '${target}'. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

/**
 * Validate that evidence of closure has at least 1 evidence item.
 *
 * @param evidence - The evidence array to validate.
 * @throws {DomainError} with code `INSUFFICIENT_EVIDENCE` if evidence is empty or not an array.
 */
export function validateEffectivenessEvidence(evidence: unknown): void {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new DomainError(
      "INSUFFICIENT_EVIDENCE",
      "At least 1 evidence item is required for effectiveness verification",
    );
  }
}

/**
 * Check if a CAPA is overdue based on due date and current status.
 *
 * @param dueDate - The due date string (YYYY-MM-DD format).
 * @param currentStatus - The current CAPA status.
 * @returns true if past due and not in verified or completed state.
 */
export function isOverdue(dueDate: string, currentStatus: CapaState): boolean {
  if (currentStatus === "verified" || currentStatus === "completed") {
    return false;
  }
  const due = new Date(dueDate);
  const now = new Date();
  // Compare date-only (strip time)
  due.setHours(23, 59, 59, 999);
  return now > due;
}

/**
 * Assert that the verifier is not the same as the creator (maker-checker enforcement).
 *
 * @param creatorId - The user who created the CAPA.
 * @param verifierId - The user attempting to verify effectiveness.
 * @throws {DomainError} with code `MAKER_CHECKER_VIOLATION` if same user.
 */
export function assertMakerCheckerForVerification(creatorId: string, verifierId: string): void {
  if (creatorId === verifierId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "Verifier cannot be the same person who created the CAPA (maker-checker enforcement)",
    );
  }
}
