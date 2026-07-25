/**
 * CAP-054 webhook secret rotation — pure domain (maker-checker + grace window).
 *
 * Rotating an HMAC secret is an authority action, so it is gated by
 * maker-checker: one admin REQUESTS a rotation (a fresh secret is generated and
 * held pending), a DIFFERENT admin APPROVES it. On approval the endpoint's
 * current secret moves to `previousSecret` (grace window) and the new secret
 * becomes active, so signatures already in flight signed with the old secret
 * still verify until the next rotation.
 */
import { timingSafeEqual } from "node:crypto";
import { signPayload } from "./commands.js";

export type RotationStatus = "pending" | "approved" | "rejected";
export type RotationDecision = "approve" | "reject";

export class RotationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RotationError";
  }
}

/** Constant-time compare of a candidate signature against an expected one. */
function sigEqual(expected: string, candidate: string): boolean {
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
}

/**
 * Verify an HMAC signature against the current secret OR, during the grace
 * window, the previous secret. Both are tried with constant-time comparison.
 */
export function verifyWithRotation(
  currentSecret: string,
  previousSecret: string | null | undefined,
  body: string,
  signature: string,
): boolean {
  if (sigEqual(signPayload(currentSecret, body), signature)) return true;
  if (previousSecret && sigEqual(signPayload(previousSecret, body), signature)) return true;
  return false;
}

/**
 * Guard the maker-checker decision. Throws when the same actor who requested
 * the rotation attempts to decide it, or when the request is not pending.
 */
export function assertCanDecide(
  request: { status: RotationStatus; requestedBy: string },
  deciderId: string,
): void {
  if (request.status !== "pending") {
    throw new RotationError("NOT_PENDING", `rotation is already ${request.status}`);
  }
  if (request.requestedBy === deciderId) {
    throw new RotationError(
      "MAKER_CHECKER",
      "the approver must be different from the requester (maker-checker)",
    );
  }
}

/** Resulting status for a decision (after assertCanDecide has passed). */
export function decidedStatus(decision: RotationDecision): RotationStatus {
  return decision === "approve" ? "approved" : "rejected";
}

export interface RotationApplication {
  secret: string;
  previousSecret: string;
  secretRotatedAt: Date;
}

/**
 * Compute the endpoint's new secret state when a rotation is approved.
 * The outgoing secret becomes the grace-window `previousSecret`.
 */
export function applyRotation(
  currentSecret: string,
  newSecret: string,
  now: Date,
): RotationApplication {
  return { secret: newSecret, previousSecret: currentSecret, secretRotatedAt: now };
}
