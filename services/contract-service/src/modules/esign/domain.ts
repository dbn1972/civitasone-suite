/**
 * E-Sign Routing — pure domain logic.
 *
 * Handles sequential signature routing for contracts:
 * - 1–10 signatories in defined order
 * - Per-signatory deadline: 1–30 calendar days
 * - Reminder on first missed deadline
 * - Escalation on second missed deadline (2× configured days)
 */

import type { SignatoryEntry } from "./schema.js";

/** Valid e-sign route statuses */
export const ESIGN_STATUSES = ["in_progress", "completed", "cancelled"] as const;
export type EsignStatus = (typeof ESIGN_STATUSES)[number];

/** Valid signatory statuses */
export const SIGNATORY_STATUSES = ["pending", "signed", "overdue"] as const;
export type SignatoryStatus = (typeof SIGNATORY_STATUSES)[number];

export class EsignDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EsignDomainError";
  }
}

/**
 * Validate signatories array constraints.
 * - 1 to 10 signatories
 * - Per-signatory deadlineDays between 1–30
 * - Ordinals must be sequential starting from 1
 * - No duplicate userIds
 */
export function validateSignatories(signatories: SignatoryEntry[]): string | null {
  if (signatories.length < 1 || signatories.length > 10) {
    return "signatories must contain 1 to 10 entries";
  }

  const userIds = new Set<string>();
  for (let i = 0; i < signatories.length; i++) {
    const s = signatories[i]!;

    if (s.ordinal !== i + 1) {
      return `signatory at index ${i} must have ordinal ${i + 1}, got ${s.ordinal}`;
    }

    if (s.deadlineDays < 1 || s.deadlineDays > 30) {
      return `signatory ${s.ordinal} deadlineDays must be between 1 and 30`;
    }

    if (userIds.has(s.userId)) {
      return `duplicate userId ${s.userId} in signatories`;
    }
    userIds.add(s.userId);
  }

  return null;
}

/**
 * Determine if the given user can sign at the current ordinal.
 */
export function canSign(
  signatories: SignatoryEntry[],
  currentOrdinal: number,
  userId: string,
): boolean {
  const current = signatories.find((s) => s.ordinal === currentOrdinal);
  if (!current) return false;
  return current.userId === userId && current.status !== "signed";
}

/**
 * Apply a signature: mark the current signatory as signed, advance ordinal.
 * Returns the updated signatories, new currentOrdinal, and whether the route is complete.
 */
export function applySignature(
  signatories: SignatoryEntry[],
  currentOrdinal: number,
  userId: string,
  signedAt: string,
): { signatories: SignatoryEntry[]; newOrdinal: number; isComplete: boolean } {
  if (!canSign(signatories, currentOrdinal, userId)) {
    throw new EsignDomainError("CANNOT_SIGN", "user is not the current signatory or already signed");
  }

  const updated = signatories.map((s) => {
    if (s.ordinal === currentOrdinal) {
      return { ...s, status: "signed" as const, signedAt };
    }
    return s;
  });

  const newOrdinal = currentOrdinal + 1;
  const isComplete = newOrdinal > signatories.length;

  return { signatories: updated, newOrdinal, isComplete };
}

/**
 * Check deadline status for the current signatory.
 *
 * Given the route creation timestamp and the signatory's deadline in days:
 * - First deadline = createdAt + sum(deadlineDays for ordinals 1..current-1) + current.deadlineDays
 * - Second deadline (escalation) = firstDeadline + current.deadlineDays (2× configured)
 *
 * Returns:
 * - "on_time" if still within first deadline
 * - "reminder" if past first deadline but before second
 * - "escalation" if past second deadline (2× configured days)
 */
export function checkDeadlineStatus(
  signatories: SignatoryEntry[],
  currentOrdinal: number,
  routeCreatedAt: Date,
  now: Date,
): "on_time" | "reminder" | "escalation" {
  const current = signatories.find((s) => s.ordinal === currentOrdinal);
  if (!current) return "on_time";

  // Calculate start time for this signatory's deadline:
  // It begins when the previous signatory signed, or at route creation for ordinal 1.
  // For simplicity, we compute based on the route creation + cumulative preceding deadlines
  // since each signatory has their own configured deadline period.
  const startDate = computeSignatoryStartDate(signatories, currentOrdinal, routeCreatedAt);

  const firstDeadlineMs = current.deadlineDays * 24 * 60 * 60 * 1000;
  const firstDeadline = new Date(startDate.getTime() + firstDeadlineMs);
  const secondDeadline = new Date(startDate.getTime() + firstDeadlineMs * 2);

  if (now >= secondDeadline) {
    return "escalation";
  }
  if (now >= firstDeadline) {
    return "reminder";
  }
  return "on_time";
}

/**
 * Compute when a signatory's deadline window begins.
 *
 * For ordinal 1: starts at route creation.
 * For ordinal N > 1: starts when the previous signatory signed.
 * If previous signatory hasn't signed yet, falls back to creation + sum of preceding deadlines.
 */
export function computeSignatoryStartDate(
  signatories: SignatoryEntry[],
  ordinal: number,
  routeCreatedAt: Date,
): Date {
  if (ordinal === 1) return routeCreatedAt;

  const prev = signatories.find((s) => s.ordinal === ordinal - 1);
  if (prev?.signedAt) {
    return new Date(prev.signedAt);
  }

  // Fallback: sum preceding deadline days from creation
  let cumulativeDays = 0;
  for (const s of signatories) {
    if (s.ordinal >= ordinal) break;
    cumulativeDays += s.deadlineDays;
  }
  return new Date(routeCreatedAt.getTime() + cumulativeDays * 24 * 60 * 60 * 1000);
}

/**
 * Compute the first deadline date for the current signatory.
 */
export function computeFirstDeadline(
  signatories: SignatoryEntry[],
  currentOrdinal: number,
  routeCreatedAt: Date,
): Date {
  const current = signatories.find((s) => s.ordinal === currentOrdinal);
  if (!current) return routeCreatedAt;

  const startDate = computeSignatoryStartDate(signatories, currentOrdinal, routeCreatedAt);
  return new Date(startDate.getTime() + current.deadlineDays * 24 * 60 * 60 * 1000);
}

/**
 * Compute the escalation deadline (2× configured days) for the current signatory.
 */
export function computeEscalationDeadline(
  signatories: SignatoryEntry[],
  currentOrdinal: number,
  routeCreatedAt: Date,
): Date {
  const current = signatories.find((s) => s.ordinal === currentOrdinal);
  if (!current) return routeCreatedAt;

  const startDate = computeSignatoryStartDate(signatories, currentOrdinal, routeCreatedAt);
  return new Date(startDate.getTime() + current.deadlineDays * 2 * 24 * 60 * 60 * 1000);
}
