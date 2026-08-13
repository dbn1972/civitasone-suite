export type ComplaintStatus = "reported" | "assigned" | "in_progress" | "resolved" | "closed";
export type ComplaintType = "blocked_drain" | "damaged_cover" | "waterlogging" | "overflow" | "structural_damage";
export type Severity = "low" | "medium" | "high" | "critical";

const TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  reported: ["assigned"],
  assigned: ["in_progress", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["closed"],
  closed: [],
};

export function validateComplaintTransition(from: ComplaintStatus, to: ComplaintStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

export const VALID_COMPLAINT_TYPES: ComplaintType[] = ["blocked_drain", "damaged_cover", "waterlogging", "overflow", "structural_damage"];
export const VALID_SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

export function classifySeverity(complaintType: ComplaintType): Severity {
  switch (complaintType) {
    case "waterlogging": return "high";
    case "overflow": return "high";
    case "structural_damage": return "critical";
    case "blocked_drain": return "medium";
    case "damaged_cover": return "medium";
  }
}
