export type ApplicationStatus = "submitted" | "feasibility_check" | "estimate_issued" | "payment_pending" | "work_ordered" | "activated" | "rejected";
export type ConnectionStatus = "active" | "suspended" | "disconnected";
export type ConnectionClass = "domestic" | "commercial" | "industrial";

const APP_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  submitted: ["feasibility_check", "rejected"],
  feasibility_check: ["estimate_issued", "rejected"],
  estimate_issued: ["payment_pending", "rejected"],
  payment_pending: ["work_ordered", "rejected"],
  work_ordered: ["activated", "rejected"],
  activated: [],
  rejected: [],
};

export function validateAppTransition(from: ApplicationStatus, to: ApplicationStatus): string | null {
  const allowed = APP_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

const CONN_TRANSITIONS: Record<ConnectionStatus, ConnectionStatus[]> = {
  active: ["suspended", "disconnected"],
  suspended: ["active", "disconnected"],
  disconnected: [],
};

export function validateConnTransition(from: ConnectionStatus, to: ConnectionStatus): string | null {
  const allowed = CONN_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

export const VALID_CONNECTION_CLASSES: ConnectionClass[] = ["domestic", "commercial", "industrial"];

// Format helpers for the sequence-reserved numbers (see repo.ts's
// nextApplicationNumber/nextConnectionNumber and
// migrations/0003_number_sequences.sql) — replaces the old
// `SEW-${Date.now()}` / `SEWC-${Date.now()}` schemes, which could collide
// under concurrent load (two requests in the same millisecond).
export function formatApplicationNumber(n: number): string {
  return `SEW-${n}`;
}

export function formatConnectionNumber(n: number): string {
  return `SEWC-${n}`;
}
