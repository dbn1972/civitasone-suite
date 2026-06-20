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
