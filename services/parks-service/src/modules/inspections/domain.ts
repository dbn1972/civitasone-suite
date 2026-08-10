export type InspectionStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

const TRANSITIONS: Record<InspectionStatus, InspectionStatus[]> = {
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function validateInspectionTransition(from: InspectionStatus, to: InspectionStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}
