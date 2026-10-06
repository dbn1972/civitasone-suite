import type { MyApprovalItem } from "@/app/_data/loaders";

/**
 * GAP-APPROVALS-HOME-06: a single source of truth for "is this task overdue",
 * used by BOTH the page's Overdue stat and the table's per-row red marker so
 * the two can never disagree (previously the stat was computed server-side with
 * Date.now() at render and the rows re-computed client-side, so a cache swap or
 * a midnight boundary between the two renders could show e.g. "Overdue 3" above
 * only 2 red rows). A task is overdue when it has a dueDate strictly in the
 * past relative to `now` (injectable for deterministic tests).
 */
export function isTaskOverdue(dueDate: string | null, now: number = Date.now()): boolean {
  if (!dueDate) return false;
  const t = new Date(dueDate).getTime();
  return Number.isFinite(t) && t < now;
}

/** Count of overdue items in a list, using the same rule as isTaskOverdue. */
export function countOverdue(items: readonly MyApprovalItem[], now: number = Date.now()): number {
  return items.reduce((n, item) => (isTaskOverdue(item.dueDate, now) ? n + 1 : n), 0);
}
