/**
 * CAP-040 — closure / reopen / archival lifecycle (pure domain).
 *
 * Any entity moves through: open -> closed -> (reopened -> closed)* -> archived.
 * Archival is terminal. This module holds the transition guards; persistence
 * and audit are the caller's. A reason is mandatory for close/reopen so the
 * lifecycle is always attributable.
 */

export type ClosureStatus = "open" | "closed" | "reopened" | "archived";

export interface GuardResult {
  allowed: boolean;
  errors: string[];
}

const CLOSEABLE = new Set<ClosureStatus>(["open", "reopened"]);

/** Close is allowed from open/reopened, with a reason. Not from archived/closed. */
export function canClose(status: ClosureStatus, reason: string | null | undefined): GuardResult {
  const errors: string[] = [];
  if (!CLOSEABLE.has(status)) errors.push("NOT_CLOSEABLE");
  if (!reason || reason.trim().length === 0) errors.push("REASON_REQUIRED");
  return { allowed: errors.length === 0, errors };
}

/** Reopen is allowed only from closed, with a reason. Archived is terminal. */
export function canReopen(status: ClosureStatus, reason: string | null | undefined): GuardResult {
  const errors: string[] = [];
  if (status !== "closed") errors.push("NOT_REOPENABLE");
  if (!reason || reason.trim().length === 0) errors.push("REASON_REQUIRED");
  return { allowed: errors.length === 0, errors };
}

/** Archive is allowed only from closed (a closed entity is filed away). */
export function canArchive(status: ClosureStatus): GuardResult {
  const errors: string[] = [];
  if (status !== "closed") errors.push("MUST_BE_CLOSED");
  return { allowed: errors.length === 0, errors };
}

/** The starting status for a never-before-seen entity. */
export function initialStatus(): ClosureStatus {
  return "open";
}
