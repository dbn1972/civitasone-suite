/**
 * visitor-service: group-visit — pure domain logic (no DB, no I/O).
 *
 * Owns:
 *   - Group size validation (2-200 members inclusive) — Property 16,
 *     Requirement 9.3.
 *   - Per-member blacklist screening with partial-failure semantics: a
 *     blacklist match on one member flags only that member for rejection
 *     and never blocks the rest of the group — Property 15, Requirement
 *     9.5. Reuses `screenIdentity` from the blacklist module per member so
 *     screening logic stays in one place.
 *   - Bulk check-in headcount reconciliation for the group-lead-scan flow
 *     — Requirement 9.6.
 */
import { screenIdentity } from "../blacklist/domain.js";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// ---------------------------------------------------------------------------
// Property 16: Group Size Validation
// ---------------------------------------------------------------------------

/** Minimum group size per Requirement 9.3. */
export const MIN_GROUP_SIZE = 2;
/** Maximum group size per Requirement 9.3. */
export const MAX_GROUP_SIZE = 200;

/**
 * Property 16: true for any integer member count between 2 and 200
 * inclusive; false for all others (including non-integers, negatives, and
 * zero/one-member "groups").
 */
export function isValidGroupSize(memberCount: number): boolean {
  return Number.isInteger(memberCount) && memberCount >= MIN_GROUP_SIZE && memberCount <= MAX_GROUP_SIZE;
}

/**
 * Throwing variant of {@link isValidGroupSize}. Maps to a 400
 * `GROUP_SIZE_INVALID` at the route layer (Requirement 9.3).
 */
export function validateGroupSize(memberCount: number): void {
  if (!isValidGroupSize(memberCount)) {
    throw new DomainError(
      "GROUP_SIZE_INVALID",
      `group size must be an integer between ${MIN_GROUP_SIZE} and ${MAX_GROUP_SIZE}, got ${memberCount}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Property 15: Group Visit Member Isolation (per-member blacklist screening)
// ---------------------------------------------------------------------------

export interface GroupMemberScreeningInput {
  memberId: string;
  /** Deterministic HMAC blind index of the member's identity document, or null if none supplied. */
  identityDocHash: string | null;
}

export interface GroupMemberScreeningResult {
  memberId: string;
  /** True iff this member's identity document matched the Blacklist (Requirement 9.5). */
  flagged: boolean;
  /** Present only when flagged; a generic reason code, never the underlying blacklist entry's reason (no disclosure to visitors). */
  reason?: string;
}

/**
 * Property 15: screens each group member's identity document hash against
 * the pre-loaded blacklist/watchlist hash sets (loaded by the caller from
 * Redis/DB, mirroring the single-visitor `screenIdentity` flow). A match
 * flags only that member for rejection — it never short-circuits or
 * removes other members from the result set, so the rest of the group can
 * proceed to individual pass generation unaffected.
 *
 * Watchlist-only matches are not flagged here: Requirement 9.5 concerns
 * blacklist rejection specifically. Watchlist handling for individual
 * visitors is covered by the blacklist module's `screenIdentity` /
 * Property 17 at the point each member's own visit record is screened.
 */
export function screenGroupMembers(
  members: readonly GroupMemberScreeningInput[],
  blacklistHashes: ReadonlySet<string>,
  watchlistHashes: ReadonlySet<string>,
): GroupMemberScreeningResult[] {
  return members.map((member) => {
    const { blocked } = screenIdentity(member.identityDocHash, blacklistHashes as Set<string>, watchlistHashes as Set<string>);

    return blocked
      ? { memberId: member.memberId, flagged: true, reason: "BLACKLIST_MATCH" }
      : { memberId: member.memberId, flagged: false };
  });
}

// ---------------------------------------------------------------------------
// Bulk check-in headcount reconciliation (Requirement 9.6)
// ---------------------------------------------------------------------------

export interface BulkCheckInReconciliation {
  /** True iff the actual scanned/confirmed count equals the expected group headcount. */
  matched: boolean;
  /** Absolute difference between expected and actual counts (0 when matched). */
  discrepancyCount: number;
}

/**
 * Confirms bulk check-in headcount for a group after the lead visitor's QR
 * is scanned at the gate (Requirement 9.6): compares the expected group
 * size against the count of members the guard confirms as physically
 * present, returning a reconciliation result rather than throwing, so the
 * gate terminal can display a mismatch warning without blocking the flow.
 */
export function confirmBulkCheckIn(expectedHeadcount: number, actualScannedCount: number): BulkCheckInReconciliation {
  if (!Number.isInteger(expectedHeadcount) || expectedHeadcount < 0) {
    throw new DomainError("VALIDATION_ERROR", `expectedHeadcount must be a non-negative integer, got ${expectedHeadcount}`);
  }
  if (!Number.isInteger(actualScannedCount) || actualScannedCount < 0) {
    throw new DomainError("VALIDATION_ERROR", `actualScannedCount must be a non-negative integer, got ${actualScannedCount}`);
  }

  const discrepancyCount = Math.abs(expectedHeadcount - actualScannedCount);
  return { matched: discrepancyCount === 0, discrepancyCount };
}
