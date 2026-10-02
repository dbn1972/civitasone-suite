import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * Roles finance-service admits on POST /v1/finance/recon/exceptions/:id/action
 * (FINANCE_ROLES in the recon module's routes). audit_officer may READ the
 * workbench but is rejected on every action, so the buttons are not offered to
 * it (GAP-FINANCE-RECONCILIATION-03 / -DETAIL-05). The server stays the
 * authority; this only avoids showing a button that would 403.
 */
export const RECON_ACTION_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;

/**
 * True when the session may act on reconciliation exceptions. An EMPTY role
 * list means the session carries no role claim (the /finance layout fails open
 * for that case), so actions are not hidden -- the server decides.
 */
export function canActOnExceptions(sessionRoles: readonly string[]): boolean {
  if (sessionRoles.length === 0) return true;
  return sessionRoles.some((r) => (RECON_ACTION_ROLES as readonly string[]).includes(r));
}

/** Resolve / write-off need a justification of at least this many characters (backend caps the note at 1000). */
export const MIN_NOTE_LENGTH = 10;
export const MAX_NOTE_LENGTH = 1000;

/**
 * Pill tone per exception status. An OPEN break is the thing that needs
 * attention, so it is red, not the global StatusPill "open => green"
 * (GAP-FINANCE-RECONCILIATION-04). Local on purpose: other modules use "open"
 * with a different meaning.
 */
export function exceptionStatusVariant(status: string): PillVariant {
  switch (status) {
    case "open":
      return "bad";
    case "investigating":
      return "warn";
    case "resolved":
      return "good";
    case "written_off":
      return "mut";
    default:
      return "info";
  }
}

/**
 * Newest `startedAt` across runs, independent of the order the API returns
 * them (GAP-FINANCE-RECONCILIATION-07). Unparseable dates are ignored.
 */
export function latestStartedAt(runs: readonly { startedAt: string }[]): string | null {
  let best: { ms: number; raw: string } | null = null;
  for (const r of runs) {
    const ms = Date.parse(r.startedAt);
    if (Number.isNaN(ms)) continue;
    if (best === null || ms > best.ms) best = { ms, raw: r.startedAt };
  }
  return best ? best.raw : null;
}

const IN_PROGRESS = new Set(["running", "in_progress", "in-progress", "pending", "queued", "started"]);

/** A run that has not finished: its counts can still move (GAP-FINANCE-RECONCILIATION-DETAIL-02). */
export function isRunInProgress(status: string | null | undefined): boolean {
  return IN_PROGRESS.has(String(status ?? "").trim().toLowerCase());
}

/**
 * Rows on one side that found no partner. `matchedCount` is the number of keys
 * present on BOTH sides (packages/reconciliation `matchedKeys`), so
 * count - matched is exactly the unpaired rows on that side (duplicate-key rows
 * included). Never negative (GAP-FINANCE-RECONCILIATION-DETAIL-04).
 */
export function unmatchedCount(count: number, matched: number): number {
  return Math.max(0, count - matched);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A person-readable actor, or null when all we have is a raw id. */
export function readableActor(actor: string | null | undefined): string | null {
  if (!actor) return null;
  return UUID_RE.test(actor) ? null : actor;
}
