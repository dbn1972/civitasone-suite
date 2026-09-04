export type TreeRequestStatus = "submitted" | "inspected" | "approved" | "rejected" | "work_ordered" | "completed";
export type TreeRequestType = "pruning" | "removal" | "new_planting" | "transplant";

const TRANSITIONS: Record<TreeRequestStatus, TreeRequestStatus[]> = {
  submitted: ["inspected", "rejected"],
  inspected: ["approved", "rejected"],
  // "work_ordered" has no implementing command/route anywhere in this module
  // (no work-order endpoint exists), so it was never reachable and every
  // /complete call on an approved request failed with TRANSITION_INVALID —
  // the entire completion workflow was dead on arrival. "completed" added as
  // a direct edge to match what's actually implemented: approve -> complete,
  // no separate work-order step. "work_ordered" kept in the status/type union
  // for forward compatibility if that step is added later.
  approved: ["work_ordered", "completed"],
  rejected: [],
  work_ordered: ["completed"],
  completed: [],
};

export function validateTreeRequestTransition(from: TreeRequestStatus, to: TreeRequestStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

export const VALID_REQUEST_TYPES: TreeRequestType[] = ["pruning", "removal", "new_planting", "transplant"];

// Pure formatter, no I/O — see complaints/domain.ts's formatComplaintNumber
// for the full rationale (identical bug, identical fix).
export function formatRequestNumber(seq: number): string {
  return `PRKT-${seq}`;
}
