export type TreeRequestStatus = "submitted" | "inspected" | "approved" | "rejected" | "work_ordered" | "completed";
export type TreeRequestType = "pruning" | "removal" | "new_planting" | "transplant";

const TRANSITIONS: Record<TreeRequestStatus, TreeRequestStatus[]> = {
  submitted: ["inspected", "rejected"],
  inspected: ["approved", "rejected"],
  approved: ["work_ordered"],
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
