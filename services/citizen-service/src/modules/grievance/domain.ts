export const GRIEVANCE_STATUSES = ["registered", "assigned", "in_progress", "resolved", "closed", "reopened"] as const;
export type GrievanceStatus = typeof GRIEVANCE_STATUSES[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = typeof PRIORITIES[number];

export const GRIEVANCE_ESCALATION_SLA_DAYS = 7;

export function assertGrievanceTransition(from: string, to: GrievanceStatus): void {
  const allowed: Record<string, GrievanceStatus[]> = {
    registered:   ["assigned"],
    assigned:     ["in_progress", "resolved"],
    in_progress:  ["resolved", "closed"],
    resolved:     ["closed", "reopened"],
    closed:       ["reopened"],
    reopened:     ["assigned", "in_progress"],
  };
  if (!allowed[from]?.includes(to)) {
    throw new Error(`INVALID_TRANSITION: cannot move from '${from}' to '${to}'`);
  }
}

/**
 * Assignment guard. A grievance is created already `assigned` (auto-assigned to its
 * department, see the register consumer), so the officer assign command on a new
 * grievance is a RE-assignment (assigned -> assigned: change assignee/department),
 * not a status transition. Every other source status still goes through the
 * lifecycle machine, so assertGrievanceTransition stays strict (no self-transitions).
 */
export function assertGrievanceAssignable(from: string): void {
  if (from === "assigned") return;
  assertGrievanceTransition(from, "assigned");
}

export function inferPriority(category: string): Priority {
  const urgent = ["corruption", "safety", "emergency"];
  const high = ["water", "electricity", "health"];
  const lower = category.toLowerCase();
  if (urgent.some((k) => lower.includes(k))) return "urgent";
  if (high.some((k) => lower.includes(k))) return "high";
  return "normal";
}

/** Map grievance category to department ref for auto-assignment. */
export function inferDepartmentRef(category: string): string {
  const lower = category.toLowerCase();
  if (lower.includes("water")) return "dept:water";
  if (lower.includes("electric")) return "dept:power";
  if (lower.includes("health")) return "dept:health";
  if (lower.includes("road") || lower.includes("transport")) return "dept:transport";
  return "dept:general";
}

export function shouldAutoEscalate(status: string, updatedAt: Date, slaDays: number, now = new Date()): boolean {
  if (status !== "assigned") return false;
  const threshold = new Date(updatedAt);
  threshold.setDate(threshold.getDate() + slaDays);
  return now > threshold;
}
