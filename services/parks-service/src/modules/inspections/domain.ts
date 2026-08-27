export type InspectionStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

const TRANSITIONS: Record<InspectionStatus, InspectionStatus[]> = {
  // "in_progress" and a cancel command have no implementing route anywhere in
  // this module — the only two commands that exist are "schedule" and
  // "complete". "completed" added as a direct edge from "scheduled" to match
  // what's actually implemented (this module's routes.ts previously never
  // even called validateInspectionTransition, so this gap was silent rather
  // than a live 422 like the sibling complaints/tree_requests modules had —
  // see routes.ts fix wiring this validator in). "in_progress"/"cancelled"
  // kept in the status/type union for forward compatibility.
  scheduled: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function validateInspectionTransition(from: InspectionStatus, to: InspectionStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}
