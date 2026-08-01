/**
 * Pure helpers for the mandatory-next-action rule (AC-002).
 *
 * The BRD requirement is "every active lead and every open opportunity must
 * carry a scheduled next step". Deciding which statuses count as "active" is
 * policy, so it lives here as pure data rather than being buried in SQL.
 */

/** Lead (contact.lead_status) values that still need a next step. */
export const ACTIVE_LEAD_STATUSES = ["new", "qualified", "nurture", "recycled"] as const;

/** Deal stages that are still open — the closed ones are Won/Lost. */
export const CLOSED_DEAL_STAGES = ["won", "lost"] as const;

/**
 * True when a subject in this status must have an open next action.
 * Comparison is case-insensitive because deal stages are stored title-cased
 * ("Negotiation") while lead statuses are lower-cased ("qualified").
 */
export function requiresNextAction(subjectStatus: string | null | undefined): boolean {
  if (!subjectStatus) return false;
  const s = subjectStatus.trim().toLowerCase();
  if (s.length === 0) return false;
  if ((CLOSED_DEAL_STAGES as readonly string[]).includes(s)) return false;
  // Explicitly inactive lead outcomes never need a follow-up.
  if (s === "converted" || s === "disqualified" || s === "inactive" || s === "deleted") return false;
  return true;
}

/** True when an open action's due date has passed. `now` is injected (testable). */
export function isOverdue(dueAt: Date | string, now: Date): boolean {
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}
