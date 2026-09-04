export type ComplaintStatus = "reported" | "assigned" | "in_progress" | "resolved" | "closed";
export type ComplaintType = "broken_equipment" | "overgrown" | "vandalism" | "lighting" | "waterlogging" | "pest";

const TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  reported: ["assigned"],
  // "in_progress" has no implementing command/route anywhere in this module
  // (no "start work" endpoint exists), so it was never reachable and every
  // /resolve call on a merely-assigned complaint failed with
  // TRANSITION_INVALID — the entire resolve workflow was dead on arrival.
  // "resolved" added as a direct edge to match what's actually implemented:
  // assign -> resolve, no separate "start" step. "in_progress" kept in the
  // status/type union for forward compatibility if that step is added later.
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

export const VALID_COMPLAINT_TYPES: ComplaintType[] = ["broken_equipment", "overgrown", "vandalism", "lighting", "waterlogging", "pest"];

// Pure formatter, no I/O — the sequence value itself comes from Postgres
// (see repo.ts's nextComplaintNumber), not from this function. Previously
// commands.ts built the whole number inline as `PRK-${Date.now()}`, which
// collided under concurrent load (see migrations/0002_number_sequences.sql).
export function formatComplaintNumber(seq: number): string {
  return `PRK-${seq}`;
}
