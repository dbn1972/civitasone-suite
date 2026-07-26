/**
 * CAP-035 — workbasket / queue management (pure domain).
 *
 * A workbasket is a named, saved filter over the task pool. This module
 * validates + normalizes a filter spec so the repo can build a safe, bounded
 * query. Only whitelisted fields are accepted (no free-form SQL).
 */

export interface WorkbasketFilter {
  status?: string[];
  assigneeId?: string | null;
  unassigned?: boolean;
  roleRef?: string;
  overdue?: boolean;
}

const ALLOWED_STATUS = new Set(["pending", "active", "in_progress", "completed", "cancelled", "escalated"]);
const ALLOWED_SORT = new Set(["created_at", "due_at", "updated_at"]);

export interface NormalizeResult {
  filter: WorkbasketFilter;
  sortOrder: string;
  errors: string[];
}

/**
 * Validate a raw filter object. Unknown statuses and sort keys are rejected so
 * a workbasket can never encode an unbounded or injectable query.
 */
export function normalizeFilter(raw: unknown, sortOrder = "created_at"): NormalizeResult {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const filter: WorkbasketFilter = {};

  if (r.status !== undefined) {
    if (!Array.isArray(r.status) || r.status.some((s) => typeof s !== "string" || !ALLOWED_STATUS.has(s))) {
      errors.push("INVALID_STATUS");
    } else {
      filter.status = r.status as string[];
    }
  }
  if (r.assigneeId !== undefined && r.assigneeId !== null) {
    if (typeof r.assigneeId !== "string") errors.push("INVALID_ASSIGNEE");
    else filter.assigneeId = r.assigneeId;
  }
  if (r.unassigned !== undefined) {
    if (typeof r.unassigned !== "boolean") errors.push("INVALID_UNASSIGNED");
    else filter.unassigned = r.unassigned;
  }
  if (r.roleRef !== undefined) {
    if (typeof r.roleRef !== "string") errors.push("INVALID_ROLE");
    else filter.roleRef = r.roleRef;
  }
  if (r.overdue !== undefined) {
    if (typeof r.overdue !== "boolean") errors.push("INVALID_OVERDUE");
    else filter.overdue = r.overdue;
  }
  if (filter.unassigned && filter.assigneeId) errors.push("ASSIGNEE_AND_UNASSIGNED");

  if (!ALLOWED_SORT.has(sortOrder)) errors.push("INVALID_SORT");

  return { filter, sortOrder, errors };
}
