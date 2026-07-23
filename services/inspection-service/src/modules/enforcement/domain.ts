/**
 * Enforcement domain — pure functions for penalty order lifecycle, maker-checker,
 * rate lookup, and amount validation.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: SVC-107_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Valid penalty order states. */
export const PENALTY_ORDER_STATES = ["draft", "issued", "paid", "waived", "appealed"] as const;
export type PenaltyOrderState = typeof PENALTY_ORDER_STATES[number];

/** Permitted state transitions for penalty orders. */
export const PENALTY_ORDER_TRANSITIONS: Record<PenaltyOrderState, PenaltyOrderState[]> = {
  draft:    ["issued"],
  issued:   ["paid", "waived", "appealed"],
  paid:     [],
  waived:   [],
  appealed: [],
};

/** Valid show cause notice states. */
export const SHOW_CAUSE_STATES = ["issued", "response_received", "closed"] as const;
export type ShowCauseState = typeof SHOW_CAUSE_STATES[number];

/** Valid prosecution referral states. */
export const PROSECUTION_STATES = ["pending", "referred", "accepted", "rejected"] as const;
export type ProsecutionState = typeof PROSECUTION_STATES[number];

/** Effective rate record used by lookupEffectiveRate. */
export interface RateRecord {
  effectiveFrom: string;
  effectiveTo: string | null;
  amount: bigint;
  isActive: boolean;
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for enforcement validation failures.
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
 * Assert that a penalty order state transition is valid.
 *
 * @param current - The current state.
 * @param target - The desired target state.
 * @throws {DomainError} with code `INVALID_TRANSITION` if transition is not permitted.
 */
export function assertValidPenaltyOrderTransition(
  current: PenaltyOrderState,
  target: PenaltyOrderState,
): void {
  const allowed = PENALTY_ORDER_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition penalty order from '${current}' to '${target}'. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

/**
 * Assert maker-checker: the checker (issuer) must be a different user than the maker (creator).
 *
 * @param makerUserId - The user who created the penalty order (maker).
 * @param checkerUserId - The user attempting to issue the order (checker).
 * @throws {DomainError} with code `MAKER_CHECKER_VIOLATION` if same user.
 */
export function assertMakerChecker(makerUserId: string, checkerUserId: string): void {
  if (makerUserId === checkerUserId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "Checker (issuing officer) cannot be the same person as the maker (creator)",
    );
  }
}

/**
 * Lookup the effective rate for a given date from a set of rates.
 * Finds the rate where effectiveFrom ≤ asOfDate < effectiveTo (or effectiveTo is null).
 *
 * @param rates - Array of rate records sorted by effectiveFrom.
 * @param asOfDate - The date to check against (YYYY-MM-DD).
 * @returns The matching rate record, or null if none found.
 */
export function lookupEffectiveRate(rates: RateRecord[], asOfDate: string): RateRecord | null {
  const dateMs = new Date(asOfDate).getTime();

  for (const rate of rates) {
    if (!rate.isActive) continue;
    const from = new Date(rate.effectiveFrom).getTime();
    const to = rate.effectiveTo ? new Date(rate.effectiveTo).getTime() : Infinity;

    if (dateMs >= from && dateMs < to) {
      return rate;
    }
  }

  return null;
}

/**
 * Validate that an amount is a positive bigint (paise, no floats).
 *
 * @param amount - The amount to validate.
 * @throws {DomainError} with code `INVALID_AMOUNT` if amount is not a positive bigint.
 */
export function validateAmount(amount: bigint): void {
  if (amount <= 0n) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `Amount must be a positive bigint (paise), got ${amount.toString()}`,
    );
  }
}
