/**
 * visitor-service: turnstile-control — pure domain logic.
 *
 * Owns:
 *   - Anti-passback check (prevent consecutive same-direction passages)
 *   - Tailgating detection (passage_count > 1)
 *   - Offline sync conflict resolution (server-wins)
 *   - Sync window validation (reject events > 24h old)
 *   - Constants for passage timeout, emergency command type, sync window
 *
 * All functions are pure (no side effects, no DB/Redis calls).
 *
 * Requirements validated: 7.3, 7.4, 7.5, 7.6, 7.8, 9.3, 9.4, 9.5
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum age of an offline event that can be synced (24 hours in ms). */
export const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Timeout after which an unconfirmed passage is marked as abandoned (15s). */
export const PASSAGE_TIMEOUT_MS = 15_000;

/** Command type for emergency unlock operations. */
export const EMERGENCY_COMMAND_TYPE = "emergency_open" as const;

// ---------------------------------------------------------------------------
// Anti-Passback Logic
// ---------------------------------------------------------------------------

/** Input for anti-passback check. */
export interface AntiPassbackCheck {
  passId: string;
  requestedDirection: "in" | "out";
  lastKnownDirection: "in" | "out" | null;
}

/**
 * Determine whether a passage in the requested direction is allowed based
 * on anti-passback rules:
 *   - First passage (lastKnownDirection is null): always allowed.
 *   - Cannot enter (in) if last known direction was already 'in'.
 *   - Cannot exit (out) if last known direction was already 'out'.
 *
 * @returns true if the passage is allowed, false if it violates anti-passback
 */
export function isPassageAllowed(check: AntiPassbackCheck, antiPassbackEnabled = true): boolean {
  // Anti-passback disabled by tenant config → every passage is allowed.
  if (!antiPassbackEnabled) {
    return true;
  }

  // First passage for this pass — always allowed
  if (check.lastKnownDirection === null) {
    return true;
  }

  // Anti-passback: can't go in the same direction consecutively
  return check.requestedDirection !== check.lastKnownDirection;
}

// ---------------------------------------------------------------------------
// Tailgating Detection
// ---------------------------------------------------------------------------

/**
 * Detect tailgating based on the passage count for a single open cycle.
 * A normal passage has passageCount = 1. Any value strictly greater than the
 * `tolerance` (default 1) indicates tailgating.
 *
 * `tolerance` is config-driven (tenant `visitor_policy` key
 * turnstile.tailgating_tolerance) and DEFAULTS to 1, so behavior is unchanged
 * for an unconfigured tenant. A site with wide turnstiles / two-person entry
 * lanes can raise the tolerance so legitimate paired passage isn't flagged.
 *
 * @param passageCount - Number of people detected during a single open cycle
 * @param tolerance - Max people allowed per open cycle before flagging (default 1)
 * @returns true if tailgating is detected (count > tolerance)
 */
export function isTailgating(passageCount: number, tolerance = 1): boolean {
  return passageCount > tolerance;
}

// ---------------------------------------------------------------------------
// Offline Sync Conflict Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an offline event conflict using server-wins strategy.
 *
 * If the pass was revoked before the event timestamp, the event is
 * retroactively invalid (the visitor shouldn't have been able to pass).
 * Otherwise, the event is valid.
 *
 * @param eventTimestamp - When the passage event occurred (device-reported)
 * @param passRevokedAt - When the pass was revoked on the server (null if not revoked)
 * @returns 'valid' if the event should be accepted, 'retroactively_invalid' if it conflicts
 */
export function resolveOfflineConflict(
  eventTimestamp: Date,
  passRevokedAt: Date | null,
): "valid" | "retroactively_invalid" {
  // Pass not revoked — event is always valid
  if (passRevokedAt === null) {
    return "valid";
  }

  // If the pass was revoked before (or at the same time as) the event, mark invalid
  if (passRevokedAt.getTime() <= eventTimestamp.getTime()) {
    return "retroactively_invalid";
  }

  // Pass was revoked after the event — event is valid
  return "valid";
}

// ---------------------------------------------------------------------------
// Sync Window Validation
// ---------------------------------------------------------------------------

/**
 * Check whether an offline event is within the acceptable sync window.
 * Events older than 24 hours from the current time are rejected.
 *
 * @param eventTimestamp - The device-reported event timestamp
 * @param now - Current server time
 * @returns true if the event is within the 24-hour sync window
 */
export function isSyncWindowValid(eventTimestamp: Date, now: Date): boolean {
  const ageMs = now.getTime() - eventTimestamp.getTime();
  return ageMs <= SYNC_WINDOW_MS;
}
