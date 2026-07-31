/**
 * Product lifecycle state machine and validation rules.
 * Valid transitions: draft → active → suspended → withdrawn → closed_to_new_business
 */

export const LIFECYCLE_STATUSES = [
  "draft",
  "active",
  "suspended",
  "withdrawn",
  "closed_to_new_business",
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/** Allowed state transitions: key = current status, value = set of reachable statuses. */
const TRANSITIONS: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  draft: ["active"],
  active: ["suspended", "withdrawn"],
  suspended: ["active", "withdrawn"],
  withdrawn: ["closed_to_new_business"],
  closed_to_new_business: [],
};

export function isValidTransition(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from as LifecycleStatus];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

/** Products must be "active" to be sold/eligible. */
export function isSellable(status: string): boolean {
  return status === "active";
}

/** Statuses that allow edits to product metadata (name, description, etc.). */
export function isEditable(status: string): boolean {
  return status === "draft" || status === "active" || status === "suspended";
}

export function isLifecycleStatus(s: string): s is LifecycleStatus {
  return (LIFECYCLE_STATUSES as readonly string[]).includes(s);
}

export interface LifecycleTransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateTransition(from: string, to: string): LifecycleTransitionResult {
  if (!isLifecycleStatus(from)) {
    return { valid: false, reason: `Unknown current status: ${from}` };
  }
  if (!isLifecycleStatus(to)) {
    return { valid: false, reason: `Unknown target status: ${to}` };
  }
  if (from === to) {
    return { valid: true };
  }
  if (!isValidTransition(from, to)) {
    return { valid: false, reason: `Cannot transition from '${from}' to '${to}'` };
  }
  return { valid: true };
}
