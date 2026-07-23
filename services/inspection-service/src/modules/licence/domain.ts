/**
 * Licence Compliance domain — pure functions for licence lifecycle,
 * expiry checks, and renewal validation.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: SVC-108_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Valid licence states. */
export const LICENCE_STATES = [
  "active",
  "expired",
  "suspended",
  "revoked",
  "pending_renewal",
] as const;
export type LicenceState = typeof LICENCE_STATES[number];

/** Permitted state transitions for licences. */
export const LICENCE_TRANSITIONS: Record<LicenceState, LicenceState[]> = {
  active:          ["expired", "suspended", "revoked", "pending_renewal"],
  expired:         ["pending_renewal"],
  suspended:       ["active", "revoked"],
  revoked:         [],
  pending_renewal: ["active"],
};

/** Valid licence condition compliance statuses. */
export const COMPLIANCE_STATUSES = ["met", "not_met", "pending"] as const;
export type ComplianceStatus = typeof COMPLIANCE_STATUSES[number];

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for licence validation failures.
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
 * Assert that a licence state transition is valid.
 *
 * @param current - The current state.
 * @param target - The desired target state.
 * @throws {DomainError} with code `INVALID_TRANSITION`
 */
export function assertValidLicenceTransition(
  current: LicenceState,
  target: LicenceState,
): void {
  const allowed = LICENCE_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition licence from '${current}' to '${target}'. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

/**
 * Check if a licence is expiring soon (within threshold days).
 *
 * @param validTo - The licence expiry date (YYYY-MM-DD).
 * @param daysThreshold - Number of days to look ahead.
 * @returns true if the licence expires within the threshold.
 */
export function isExpiringSoon(validTo: string, daysThreshold: number): boolean {
  // Compare date-only to avoid timezone-related edge cases
  const expiry = new Date(validTo);
  expiry.setHours(23, 59, 59, 999);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= daysThreshold;
}

/**
 * Check if a licence has expired.
 *
 * @param validTo - The licence expiry date (YYYY-MM-DD).
 * @returns true if past validTo.
 */
export function isExpired(validTo: string): boolean {
  const expiry = new Date(validTo);
  expiry.setHours(23, 59, 59, 999);
  return new Date() > expiry;
}

/**
 * Assert that renewal is allowed for the current licence status.
 * Only active or expired licences can be renewed.
 *
 * @param currentStatus - The current licence status.
 * @throws {DomainError} with code `RENEWAL_NOT_ALLOWED`
 */
export function assertRenewalAllowed(currentStatus: LicenceState): void {
  const renewableStates: LicenceState[] = ["active", "expired"];
  if (!renewableStates.includes(currentStatus)) {
    throw new DomainError(
      "RENEWAL_NOT_ALLOWED",
      `Cannot renew licence in '${currentStatus}' state. Only active or expired licences can be renewed`,
    );
  }
}
