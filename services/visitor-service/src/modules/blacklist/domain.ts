/**
 * visitor-service: blacklist/watchlist — pure domain logic.
 *
 * Owns:
 *   - Identity screening (blacklist blocks, watchlist flags) against
 *     pre-loaded hash sets — see Property 2 and Property 17 in design.md.
 *     The actual Redis/DB hash lookups happen in repo.ts; this module only
 *     operates on sets already loaded by the caller so screening logic is
 *     testable without any I/O.
 *   - Maker-checker (segregation of duties) enforcement for blacklist entry
 *     approval — see Property 18 in design.md.
 *   - Blacklist entry status state machine (pending -> active -> expired /
 *     archived).
 *   - Auto-expiry check for entries with a non-null `expiresAt`.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * Screen an identity document hash against pre-loaded blacklist/watchlist
 * hash sets.
 *
 * - `blocked: true` when the hash is present in the blacklist set. The
 *   caller MUST NOT disclose the blacklist reason to the visitor (Property 2).
 * - `flagged: true` when the hash is present in the watchlist set and is
 *   NOT blacklisted. Watchlist matches proceed through normal approval but
 *   carry a security flag visible to host/security officers (Property 17).
 * - A `null` docHash (no identity document supplied) never matches either
 *   set.
 *
 * This is a pure function: `blacklistHashes` and `watchlistHashes` are
 * caller-supplied sets (loaded from Redis/DB in repo.ts), so no I/O happens
 * here.
 */
export function screenIdentity(
  docHash: string | null,
  blacklistHashes: Set<string>,
  watchlistHashes: Set<string>,
): { blocked: boolean; flagged: boolean } {
  if (!docHash) {
    return { blocked: false, flagged: false };
  }

  const blocked = blacklistHashes.has(docHash);
  const flagged = !blocked && watchlistHashes.has(docHash);

  return { blocked, flagged };
}

/**
 * Segregation of duties: the approver (checker) of a blacklist entry must
 * differ from the creator (maker). Self-approval is rejected (Property 18).
 */
export function assertDistinctMakerChecker(creatorId: string, approverId: string): void {
  if (creatorId && approverId && creatorId === approverId) {
    throw new DomainError("SOD_VIOLATION", "maker and checker must be different actors (self-approval rejected)");
  }
}

/**
 * Blacklist entry lifecycle.
 *   pending  — created by maker, awaiting a distinct checker's approval.
 *   active   — approved by a different user; screening enforced.
 *   expired  — auto-transitioned once `expiresAt` has passed.
 *   archived — manually retired (superseded, withdrawn, data-retention purge).
 */
export type BlacklistStatus = "pending" | "active" | "expired" | "archived";

const VALID_TRANSITIONS: Record<BlacklistStatus, BlacklistStatus[]> = {
  pending: ["active", "archived"],
  active: ["expired", "archived"],
  expired: ["archived"],
  archived: [],
};

export function assertBlacklistTransition(from: string, to: BlacklistStatus): void {
  const allowed = VALID_TRANSITIONS[from as BlacklistStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `blacklist entry cannot transition from '${from}' to '${to}'`);
  }
}

/**
 * Auto-expiry check for a blacklist (or watchlist) entry. A `null`
 * `expiresAt` means the entry never expires. `now` defaults to the current
 * time but is injectable for deterministic testing.
 */
export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) {
    return false;
  }
  return expiresAt.getTime() <= now.getTime();
}
