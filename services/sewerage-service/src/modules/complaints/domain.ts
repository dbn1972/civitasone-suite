export type ComplaintStatus = "reported" | "assigned" | "in_progress" | "resolved" | "closed";
export type ComplaintType = "blockage" | "overflow" | "manhole_damage" | "odour" | "backflow";

// BUG FIX (test-debt closure pass): "in_progress" is declared in the type and
// in this transition map, but no command/route/consumer anywhere in this
// service ever moves a complaint into "in_progress" -- topics.ts only defines
// complaintCreate/complaintAssign/complaintResolve/complaintClose, and
// routes.ts has no "start work" endpoint. With the original map (assigned:
// ["in_progress", "closed"], in_progress: ["resolved", "closed"]),
// POST /v1/sewerage/complaints/:id/resolve validated
// validateComplaintTransition("assigned", "resolved") for every real
// complaint, which is not in TRANSITIONS.assigned -- so /resolve always
// returned 422 TRANSITION_INVALID and no complaint could ever be resolved.
// Proven live in tests/complaints-flow.integration.test.ts. Fixed by allowing
// "resolved" directly from "assigned" (the only reachable predecessor state)
// rather than inventing a new "start work" command/route, which is a larger
// change than this pass's scope. "in_progress" is left in the type/map for
// forward-compatibility if a future change adds that transition.
const TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  reported: ["assigned"],
  assigned: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["closed"],
  closed: [],
};

export function validateComplaintTransition(from: ComplaintStatus, to: ComplaintStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

export const VALID_COMPLAINT_TYPES: ComplaintType[] = ["blockage", "overflow", "manhole_damage", "odour", "backflow"];

// Format helper for the sequence-reserved complaint number (see repo.ts's
// nextComplaintNumber and migrations/0003_number_sequences.sql) — replaces
// the old `SEWC-${Date.now()}` scheme.
export function formatComplaintNumber(n: number): string {
  return `SEWC-${n}`;
}
