/**
 * Findings domain — pure functions for finding lifecycle, validation, number generation,
 * severity derivation, and deletion protection.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 9.8_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Valid finding severity levels derived from the linked provision's severity class. */
export const SEVERITY_LEVELS = ["critical", "major", "minor", "observation"] as const;
export type Severity = typeof SEVERITY_LEVELS[number];

/** Valid finding lifecycle states. */
export const FINDING_STATES = ["open", "notice_issued", "overdue", "closed"] as const;
export type FindingState = typeof FINDING_STATES[number];

/** Permitted state transitions for findings. */
export const FINDING_TRANSITIONS: Record<FindingState, FindingState[]> = {
  open:           ["notice_issued", "closed"],
  notice_issued:  ["overdue", "closed"],
  overdue:        ["closed"],
  closed:         [],
};

/**
 * Inspection states that prevent deletion of associated findings.
 * Once an inspection reaches one of these states, findings are immutable.
 *
 * _Validates: Requirement 9.8_
 */
export const PROTECTED_INSPECTION_STATES = ["under_review", "finalized"] as const;
export type ProtectedInspectionState = typeof PROTECTED_INSPECTION_STATES[number];

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for findings validation failures.
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
 * Assert that a finding state transition is valid.
 *
 * @param current - The current state of the finding.
 * @param target - The desired target state.
 * @throws {DomainError} with code `INVALID_TRANSITION` if the transition is not permitted.
 *
 * _Validates: Requirements 9.5, 9.6_
 */
export function assertValidFindingTransition(current: FindingState, target: FindingState): void {
  const allowed = FINDING_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition finding from '${current}' to '${target}'. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

/**
 * Generate a finding number from a year and sequence counter.
 *
 * Format: `FND-{YYYY}-{SEQ:6}` — e.g. `FND-2025-000001`.
 * The sequence is zero-padded to 6 digits.
 *
 * @param year - The 4-digit year for the finding number.
 * @param seq - The sequence number (must be a positive integer).
 * @returns The formatted finding number string.
 * @throws {DomainError} with code `INVALID_SEQUENCE` if seq is not a positive integer.
 * @throws {DomainError} with code `INVALID_YEAR` if year is not a valid 4-digit year.
 *
 * _Validates: Requirement 9.3_
 */
export function generateFindingNumber(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new DomainError(
      "INVALID_YEAR",
      `Year must be a 4-digit integer, got ${year}`,
    );
  }

  if (!Number.isInteger(seq) || seq < 1) {
    throw new DomainError(
      "INVALID_SEQUENCE",
      `Sequence must be a positive integer, got ${seq}`,
    );
  }

  const paddedSeq = String(seq).padStart(6, "0");
  return `FND-${year}-${paddedSeq}`;
}

/**
 * Derive and validate a finding's severity from the linked provision's severity class.
 *
 * The provision's `severityClass` must be one of the valid severity levels:
 * `critical`, `major`, `minor`, or `observation`.
 *
 * @param provisionSeverityClass - The severity classification from the linked provision.
 * @returns The validated severity value.
 * @throws {DomainError} with code `INVALID_SEVERITY` if the value is not a recognized severity level.
 *
 * _Validates: Requirement 9.2_
 */
export function deriveSeverity(provisionSeverityClass: string): Severity {
  if (!SEVERITY_LEVELS.includes(provisionSeverityClass as Severity)) {
    throw new DomainError(
      "INVALID_SEVERITY",
      `Invalid severity class '${provisionSeverityClass}'. Must be one of: ${SEVERITY_LEVELS.join(", ")}`,
    );
  }
  return provisionSeverityClass as Severity;
}

/**
 * Assert that a finding may be deleted given the parent inspection's current state.
 *
 * Findings cannot be deleted (even soft-deleted) once the parent inspection
 * reaches `under_review` or `finalized` status.
 *
 * @param inspectionState - The current state of the parent inspection.
 * @throws {DomainError} with code `DELETION_PROTECTED` if the inspection is in a protected state.
 *
 * _Validates: Requirement 9.8_
 */
export function assertDeletionAllowed(inspectionState: string): void {
  if ((PROTECTED_INSPECTION_STATES as readonly string[]).includes(inspectionState)) {
    throw new DomainError(
      "DELETION_PROTECTED",
      `Cannot delete finding: parent inspection is in '${inspectionState}' state`,
    );
  }
}
