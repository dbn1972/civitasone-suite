export type ActionType = "cleaning" | "repair" | "replacement" | "desilting";

export const VALID_ACTION_TYPES: ActionType[] = ["cleaning", "repair", "replacement", "desilting"];

export function isValidActionType(type: string): type is ActionType {
  return VALID_ACTION_TYPES.includes(type as ActionType);
}

// Complaint statuses from which logging a field action is meaningful. A complaint
// must already be assigned (or have work underway) before field work is logged
// against it — logging against a still-"reported" (unassigned), "resolved", or
// "closed" complaint would misrepresent the workflow. Kept as a plain string[]
// rather than importing ComplaintStatus from the sibling `complaints` module, to
// match the loose-coupling convention used for analogous constants elsewhere in
// this fleet (e.g. market-service's LIFECYCLE_ACTIONABLE_STATUSES).
//
// This also backs the fix for a previously-unreachable transition: nothing in
// this service ever moved a complaint to "in_progress" (see complaints/domain.ts
// TRANSITIONS — "resolved" is only a valid target from "in_progress", never
// directly from "assigned"), which made POST /complaints/:id/resolve 422 for
// every real complaint. The field-action consumer now performs that transition
// itself, since field work starting is what "in_progress" actually means.
export const FIELD_ACTION_ELIGIBLE_COMPLAINT_STATUSES: string[] = ["assigned", "in_progress"];
