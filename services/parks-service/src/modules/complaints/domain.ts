export type ComplaintStatus = "reported" | "assigned" | "in_progress" | "resolved" | "closed";
export type ComplaintType = "broken_equipment" | "overgrown" | "vandalism" | "lighting" | "waterlogging" | "pest";

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

export const VALID_COMPLAINT_TYPES: ComplaintType[] = ["broken_equipment", "overgrown", "vandalism", "lighting", "waterlogging", "pest"];
