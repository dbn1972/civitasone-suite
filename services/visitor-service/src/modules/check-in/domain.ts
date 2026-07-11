/**
 * visitor-service: check-in / gate-verification — pure domain logic.
 *
 * Owns:
 *   - Classification of `verifyPassQr` (shared/qr-crypto.ts) outcomes into a
 *     verification reason, and the full gate-verification decision
 *     (signature/claims -> revocation -> location-scope -> zone-scope ->
 *     blacklist/watchlist) — see Property 9 in design.md.
 *   - Check-in / check-out state machine (active|issued -> checked_in ->
 *     checked_out), rejecting a duplicate check-in without a preceding
 *     check-out unless the pass is a multi-entry recurring pass —
 *     see Property 11.
 *   - Visit-duration computation — see Property 12.
 *   - Overstay comparison against `valid_until` — see Property 13.
 *
 * This module performs NO I/O: signature verification (`verifyPassQr`),
 * Redis revocation-set lookups, and blacklist/watchlist hash lookups all
 * happen in the caller (routes.ts / repo.ts); this file only operates on
 * already-fetched/precomputed results so the decision logic is fully
 * testable without any network, DB, or Redis dependency.
 */
import type { PassQrPayload } from "../../shared/qr-crypto.js";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// ── QR Signature/Claim Result Classification ──────────────────────────────

/**
 * Reason a `verifyPassQr` call failed. Callers (routes.ts) invoke
 * `verifyPassQr` and, on a thrown `jose` error, pass the error to
 * `classifyQrError` to obtain one of these reasons before calling
 * `verifyQrForGate`.
 */
export type QrFailureReason = "invalid_signature" | "expired" | "not_yet_valid" | "malformed";

/**
 * The result of the signature/claims check (Property 9 conditions a & b:
 * valid signature, current time within [valid_from, valid_until]). This is
 * produced by the caller from a try/catch around `verifyPassQr` — this
 * module never calls `verifyPassQr` itself.
 */
export type QrSignatureCheckResult =
  | { ok: true; payload: PassQrPayload }
  | { ok: false; reason: QrFailureReason };

/**
 * Classifies an error thrown by `jose`'s `jwtVerify` (as used inside
 * `verifyPassQr`) into a `QrFailureReason`. Pure function — inspects only
 * the error's `code`/`claim` properties, performs no I/O.
 *
 * `jose` error codes: `ERR_JWT_EXPIRED` (exp claim failed),
 * `ERR_JWT_CLAIM_VALIDATION_FAILED` (nbf/iss/etc — `claim` distinguishes
 * which), `ERR_JWS_SIGNATURE_VERIFICATION_FAILED` / `ERR_JWS_INVALID` /
 * `ERR_JWT_INVALID` (signature or structural failure).
 */
export function classifyQrError(err: unknown): QrFailureReason {
  const code = (err as { code?: string } | null | undefined)?.code;

  if (code === "ERR_JWT_EXPIRED") {
    return "expired";
  }
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    const claim = (err as { claim?: string }).claim;
    return claim === "nbf" ? "not_yet_valid" : "invalid_signature";
  }
  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" || code === "ERR_JWS_INVALID" || code === "ERR_JWT_INVALID") {
    return "invalid_signature";
  }
  // Unknown/unparseable error — fail closed as an invalid signature.
  return "invalid_signature";
}

// ── Gate Verification Decision ─────────────────────────────────────────────

/** The gate performing verification, as resolved from `gates` (location module). */
export interface GateContext {
  locationId: string;
  areaId: string | null; // null = perimeter gate (see design's zone-boundary rule)
}

/** Pre-loaded blacklist/watchlist screening result (see modules/blacklist/domain.ts `screenIdentity`). */
export interface ScreeningResult {
  blocked: boolean;
  flagged: boolean;
}

export interface QrVerificationSuccess {
  payload: PassQrPayload;
  /** True when the visitor matches the watchlist (allowed through, but flagged — Requirement 5.7). */
  watchlistFlagged: boolean;
}

/**
 * Property 9: QR Verification Correctness — for any QR JWT, verification
 * succeeds if and only if:
 *   (a) the signature/claims check succeeded (`qrCheck.ok`),
 *   (b) the pass ID is not in the revocation set (`isRevoked` false),
 *   (c) the pass's `location_id` matches the gate's location (Property 26 /
 *       Requirement 22.3, 22.5),
 *   (d) the gate's area (if any) is within the pass's `permitted_areas`
 *       (Property 19 / Requirement 11.4, 11.5), and
 *   (e) the visitor is not blacklisted (Requirement 5.4, 10.4).
 * If any condition fails, throws a `DomainError` identifying which
 * condition failed. On success, also surfaces whether the visitor matches
 * the watchlist so the caller can raise a security-control-room alert
 * (Requirement 5.7) without blocking entry.
 */
export function verifyQrForGate(
  qrCheck: QrSignatureCheckResult,
  gate: GateContext,
  isRevoked: boolean,
  screening: ScreeningResult,
): QrVerificationSuccess {
  if (!qrCheck.ok) {
    const codeByReason: Record<QrFailureReason, string> = {
      invalid_signature: "PASS_INVALID_SIGNATURE",
      expired: "PASS_EXPIRED",
      not_yet_valid: "PASS_NOT_YET_VALID",
      malformed: "PASS_INVALID_SIGNATURE",
    };
    throw new DomainError(codeByReason[qrCheck.reason], `QR verification failed: ${qrCheck.reason}`);
  }

  if (isRevoked) {
    throw new DomainError("PASS_REVOKED", "digital pass has been revoked");
  }

  const { payload } = qrCheck;

  if (!isLocationScopeValid(payload.location_id, gate.locationId)) {
    throw new DomainError(
      "PASS_WRONG_LOCATION",
      `pass is scoped to location '${payload.location_id}', not gate location '${gate.locationId}'`,
    );
  }

  if (!isAreaPermitted(gate.areaId, payload.permitted_areas)) {
    throw new DomainError(
      "PASS_WRONG_ZONE",
      `pass permitted areas do not include gate area '${gate.areaId ?? "(perimeter)"}'`,
    );
  }

  // Blacklist match blocks entry without disclosing the reason (Requirement 10.4).
  // Watchlist match is surfaced to the caller but does not block (Requirement 5.7, 10.5).
  if (screening.blocked) {
    throw new DomainError("VISITOR_BLACKLISTED", "visitor is blacklisted");
  }

  return { payload, watchlistFlagged: screening.flagged };
}

/**
 * Property 26: Location-Scoped Pass Verification — a pass encoded with
 * `location_id` L only verifies successfully at gates belonging to L.
 */
export function isLocationScopeValid(passLocationId: string, gateLocationId: string): boolean {
  return passLocationId === gateLocationId;
}

/**
 * Property 19: Zone-Restricted Pass Enforcement — a null `areaId` denotes a
 * perimeter gate, which every valid (location-scoped) pass may use
 * regardless of its `permitted_areas`. A non-null `areaId` (a
 * restricted-area/zone-boundary gate) requires that area to be explicitly
 * listed in `permittedAreas`.
 */
export function isAreaPermitted(areaId: string | null, permittedAreas: string[]): boolean {
  if (areaId === null) return true;
  return permittedAreas.includes(areaId);
}

// ── Check-In / Check-Out State Machine ─────────────────────────────────────

/**
 * Digital_Pass lifecycle states relevant to gate check-in/out. `issued` is
 * accepted as an alias for `active` (a pass that has been generated and
 * delivered but not yet used) — some upstream flows (e.g. group-visit,
 * recurring-pass) may model the pre-check-in state as `issued` rather than
 * `active`; both are valid check-in sources.
 */
export type CheckInStatus = "active" | "issued" | "checked_in" | "checked_out" | "revoked" | "expired";

const CHECK_IN_SOURCE_STATES: ReadonlySet<CheckInStatus> = new Set(["active", "issued"]);

/** Pass type, mirrored from `modules/digital-pass/domain.ts` (`PassQrPayload.pass_type`). */
export type PassType = "single" | "multi_day" | "recurring" | "event";

export interface CheckInOptions {
  passType: PassType;
  /**
   * True when the recurring pass is configured to permit multiple
   * entries without an intervening check-out being required (e.g. a
   * contractor whose helper/vehicle re-enters the same day). Ignored for
   * non-recurring pass types.
   */
  multiEntryRecurring?: boolean;
}

/**
 * Property 11: Check-In/Check-Out State Machine Invariant — transitions a
 * pass to `checked_in`. Allowed from `active`/`issued` (first entry) and
 * from `checked_out` (subsequent entries on a multi-day/recurring pass).
 * A pass already in `checked_in` state rejects a second check-in
 * (`PASS_ALREADY_CHECKED_IN`) UNLESS `passType` is `recurring` AND
 * `multiEntryRecurring` is true, per Requirement 6.5.
 */
export function checkIn(currentStatus: CheckInStatus, options: CheckInOptions): "checked_in" {
  if (CHECK_IN_SOURCE_STATES.has(currentStatus) || currentStatus === "checked_out") {
    return "checked_in";
  }

  if (currentStatus === "checked_in") {
    const multiEntryAllowed = options.passType === "recurring" && options.multiEntryRecurring === true;
    if (multiEntryAllowed) {
      return "checked_in";
    }
    throw new DomainError(
      "PASS_ALREADY_CHECKED_IN",
      "pass is already checked in; a preceding check-out is required before re-entry",
    );
  }

  throw new DomainError("INVALID_TRANSITION", `digital pass cannot check in from status '${currentStatus}'`);
}

/**
 * Property 11: Check-In/Check-Out State Machine Invariant — transitions a
 * pass to `checked_out`. Only valid from `checked_in`; any other source
 * status is rejected with `PASS_NOT_CHECKED_IN` (Requirement 6.1).
 */
export function checkOut(currentStatus: CheckInStatus): "checked_out" {
  if (currentStatus !== "checked_in") {
    throw new DomainError(
      "PASS_NOT_CHECKED_IN",
      `digital pass cannot check out from status '${currentStatus}'; pass is not currently checked in`,
    );
  }
  return "checked_out";
}

// ── Visit Duration ──────────────────────────────────────────────────────────

/**
 * Property 12: Visit Duration Computation — for any pair of check-in/
 * check-out timestamps where check-out > check-in, the duration equals
 * (checkOutAt - checkInAt) in milliseconds. Throws if `checkOutAt` does
 * not strictly follow `checkInAt`.
 */
export function computeVisitDurationMs(checkInAt: Date, checkOutAt: Date): number {
  const durationMs = checkOutAt.getTime() - checkInAt.getTime();
  if (durationMs <= 0) {
    throw new DomainError("INVALID_DURATION", "checkOutAt must be strictly after checkInAt");
  }
  return durationMs;
}

/**
 * Visit-duration computation in whole minutes (rounded to the nearest
 * minute), for analytics storage (Requirement 6.2). Derived from
 * `computeVisitDurationMs` so both the exact-millisecond invariant
 * (Property 12) and the minutes-based analytics value share one
 * calculation.
 */
export function computeVisitDuration(checkInAt: Date, checkOutAt: Date): number {
  return Math.round(computeVisitDurationMs(checkInAt, checkOutAt) / 60_000);
}

// ── Overstay Detection ───────────────────────────────────────────────────────

/**
 * Property 13: Overstay Detection — true once `now` strictly exceeds
 * `validUntil`. A visitor whose current time is within `validUntil`
 * (i.e. `now <= validUntil`) is NOT overstayed.
 */
export function isOverstayed(now: Date, validUntil: Date): boolean {
  return now.getTime() > validUntil.getTime();
}
