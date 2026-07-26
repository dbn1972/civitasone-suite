/**
 * CAP-090 — pure domain logic for security incident & breach management.
 * No I/O here so it is trivially unit-testable and reused by routes + workers.
 */

export type IncidentStatus = "detected" | "triaged" | "contained" | "resolved" | "closed";
export type BreachAuthority = "data_protection_board" | "data_principals";

/** Legal lifecycle: forward-only through the ordered states. */
export const INCIDENT_ORDER: IncidentStatus[] = ["detected", "triaged", "contained", "resolved", "closed"];

const ALLOWED: Record<IncidentStatus, IncidentStatus[]> = {
  detected:  ["triaged"],
  triaged:   ["contained"],
  contained: ["resolved"],
  resolved:  ["closed"],
  closed:    [],
};

/** True when `to` is a legal next state from `from`. */
export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

/**
 * DPDP §8(6) sets a FIXED statutory breach-notification window: notification to
 * the Data Protection Board / affected Data Principals is due within 72 hours of
 * becoming aware of the breach. This is a hard legal ceiling — it must never be
 * lengthened by a caller (that would silently self-extend the compliance clock).
 * A SHORTER internal SLA is acceptable; a longer one is not.
 */
export const DPDP_BREACH_WINDOW_HOURS = 72;

/**
 * Statutory breach-notification deadline. `windowHours` is hard-capped at
 * DPDP_BREACH_WINDOW_HOURS (DPDP §8(6)) as defence-in-depth: even if a caller
 * somehow supplies a larger value, the deadline can never exceed detectedAt+72h.
 * A shorter self-imposed window is honoured.
 */
export function computeBreachDeadline(detectedAt: Date, windowHours = DPDP_BREACH_WINDOW_HOURS): Date {
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new Error("windowHours must be a positive number");
  }
  const capped = Math.min(windowHours, DPDP_BREACH_WINDOW_HOURS);
  return new Date(detectedAt.getTime() + capped * 3_600_000);
}

/** A pending notification is overdue once `now` passes its deadline. */
export function isBreachOverdue(deadlineAt: Date, status: string, now = new Date()): boolean {
  return status === "pending" && now.getTime() > deadlineAt.getTime();
}

/** Whole hours remaining until the deadline (negative once overdue). */
export function hoursUntilDeadline(deadlineAt: Date, now = new Date()): number {
  return Math.floor((deadlineAt.getTime() - now.getTime()) / 3_600_000);
}

/** Timestamp column set when a status is first reached. */
export function timestampColumnFor(to: IncidentStatus): string | null {
  switch (to) {
    case "triaged":   return "triagedAt";
    case "contained": return "containedAt";
    case "resolved":  return "resolvedAt";
    case "closed":    return "closedAt";
    default:          return null;
  }
}

/**
 * Maker-checker on close: the actor who closes an incident MUST differ from the
 * actor who reported it (segregation of duties). Returns an error message or
 * null when the pair is acceptable.
 */
export function checkCloseSegregation(reportedBy: string, closingActor: string): string | null {
  return reportedBy === closingActor
    ? "maker-checker: the incident reporter cannot close their own incident"
    : null;
}

/** Domain event topic for a status transition. */
export function eventTopicForStatus(to: IncidentStatus): string {
  return `security.incident.${to}`;
}
