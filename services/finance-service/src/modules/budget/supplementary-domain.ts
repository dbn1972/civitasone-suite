/**
 * SVC-035 — Supplementary / additional grant pure domain.
 *
 * A supplementary demand adds fresh provision to an existing budget head under a
 * sanctioning authority, optionally capped by a limit, approved maker-checker,
 * and on approval it raises the budget's availability. No DB, no HTTP, no queue.
 */
import { DomainError } from "./domain.js";

export type SupplementaryStatus = "pending_approval" | "approved" | "rejected";
export type SupplementaryKind = "supplementary" | "additional" | "excess";

const KINDS: SupplementaryKind[] = ["supplementary", "additional", "excess"];

export function assertValidSupplementaryKind(kind: string): void {
  if (!KINDS.includes(kind as SupplementaryKind)) {
    throw new DomainError("INVALID_KIND", `supplementary kind must be one of ${KINDS.join(", ")}`);
  }
}

export interface SupplementaryInput {
  amountMinor: bigint;
  authority: string;
  /** Optional statutory/administrative cap; 0 or negative means "no cap". */
  limitMinor: bigint;
}

/**
 * A supplementary demand must add a positive amount under a named authority. If
 * a positive limit is supplied, the amount may not exceed it (statutory cap on
 * supplementary provision).
 */
export function assertSupplementaryValid(s: SupplementaryInput): void {
  if (s.amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "supplementary amount must be positive");
  }
  if (!s.authority || s.authority.trim().length === 0) {
    throw new DomainError("MISSING_AUTHORITY", "supplementary demand requires a sanctioning authority");
  }
  if (s.limitMinor > 0n && s.amountMinor > s.limitMinor) {
    throw new DomainError(
      "LIMIT_EXCEEDED",
      `supplementary ${s.amountMinor} paise exceeds the sanctioned limit ${s.limitMinor} paise`,
    );
  }
}

/**
 * Maker-checker on approval: a supplementary demand must be approved by an
 * officer other than the one who raised it.
 */
export function assertSupplementaryApproverDistinct(createdBy: string, approverId: string): void {
  if (createdBy === approverId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "supplementary approver must differ from the officer who raised it (maker-checker)",
    );
  }
}

const TRANSITIONS: Record<SupplementaryStatus, SupplementaryStatus[]> = {
  pending_approval: ["approved", "rejected"],
  approved:         [],
  rejected:         [],
};

export function assertSupplementaryTransition(from: SupplementaryStatus, to: SupplementaryStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `cannot move supplementary from '${from}' to '${to}'`);
  }
}

/**
 * Availability after a supplementary is applied. A supplementary raises both the
 * budget estimate (BE) and the revised estimate (RE) by the granted amount, so
 * the RE ≤ BE invariant is preserved and available balance
 * (RE − utilised) increases by exactly the supplementary amount.
 */
export function availabilityAfterSupplementary(reMinor: bigint, utilisedMinor: bigint, amountMinor: bigint): bigint {
  return (reMinor + amountMinor) - utilisedMinor;
}
