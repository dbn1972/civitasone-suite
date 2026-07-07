/**
 * ITIL ticket type domain logic — pure functions for workflow state machines.
 *
 * Each ticket type (incident, problem, change) has its own status workflow
 * with defined valid transitions. Invalid transitions are rejected.
 */

// ─── Ticket Types ───────────────────────────────────────────────────────────

export const TICKET_TYPES = ["incident", "problem", "change"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

// ─── Status Workflows per Type ──────────────────────────────────────────────

export const INCIDENT_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const PROBLEM_STATUSES = ["identified", "root_cause", "fix_applied", "closed"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export const CHANGE_STATUSES = ["requested", "approved", "implemented", "reviewed", "closed"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export type TicketStatus = IncidentStatus | ProblemStatus | ChangeStatus;

// ─── Valid Transitions (State Machine Definitions) ──────────────────────────

const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ["investigating"],
  investigating: ["resolved"],
  resolved: ["closed"],
  closed: [],
};

const PROBLEM_TRANSITIONS: Record<ProblemStatus, readonly ProblemStatus[]> = {
  identified: ["root_cause"],
  root_cause: ["fix_applied"],
  fix_applied: ["closed"],
  closed: [],
};

const CHANGE_TRANSITIONS: Record<ChangeStatus, readonly ChangeStatus[]> = {
  requested: ["approved"],
  approved: ["implemented"],
  implemented: ["reviewed"],
  reviewed: ["closed"],
  closed: [],
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get valid statuses for a given ticket type.
 */
export function getStatusesForType(type: TicketType): readonly string[] {
  switch (type) {
    case "incident":
      return INCIDENT_STATUSES;
    case "problem":
      return PROBLEM_STATUSES;
    case "change":
      return CHANGE_STATUSES;
  }
}

/**
 * Get the initial status for a given ticket type.
 */
export function getInitialStatus(type: TicketType): string {
  switch (type) {
    case "incident":
      return "open";
    case "problem":
      return "identified";
    case "change":
      return "requested";
  }
}

/**
 * Validate whether a status transition is allowed for a given ticket type.
 * Returns true if the transition is valid, false otherwise.
 */
export function isValidTransition(type: TicketType, from: string, to: string): boolean {
  const transitions = getTransitionsMap(type);
  if (!transitions) return false;
  const allowed = transitions[from as keyof typeof transitions];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

/**
 * Get allowed next statuses for a ticket type and current status.
 */
export function getValidNextStatuses(type: TicketType, currentStatus: string): readonly string[] {
  const transitions = getTransitionsMap(type);
  if (!transitions) return [];
  const allowed = transitions[currentStatus as keyof typeof transitions];
  return (allowed as readonly string[] | undefined) ?? [];
}

/**
 * Validate that a status is valid for the given ticket type.
 */
export function isValidStatusForType(type: TicketType, status: string): boolean {
  return (getStatusesForType(type) as readonly string[]).includes(status);
}

// ─── Required Fields per Type ───────────────────────────────────────────────

export interface IncidentRequiredFields {
  impactLevel: string;
  urgency: string;
}

export interface ProblemRequiredFields {
  symptomDescription: string;
}

export interface ChangeRequiredFields {
  changeReason: string;
  riskAssessment: string;
}

export type TypeSpecificFields = IncidentRequiredFields | ProblemRequiredFields | ChangeRequiredFields;

/**
 * Validate type-specific required fields. Returns an array of missing field names
 * (empty if all required fields are present).
 */
export function validateTypeFields(
  type: TicketType,
  fields: Record<string, unknown> | undefined,
): string[] {
  if (!fields) {
    return getRequiredFieldNames(type);
  }

  const required = getRequiredFieldNames(type);
  const missing: string[] = [];

  for (const field of required) {
    const value = fields[field];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Get the list of required field names for a ticket type.
 */
export function getRequiredFieldNames(type: TicketType): string[] {
  switch (type) {
    case "incident":
      return ["impactLevel", "urgency"];
    case "problem":
      return ["symptomDescription"];
    case "change":
      return ["changeReason", "riskAssessment"];
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

function getTransitionsMap(type: TicketType): Record<string, readonly string[]> | null {
  switch (type) {
    case "incident":
      return INCIDENT_TRANSITIONS;
    case "problem":
      return PROBLEM_TRANSITIONS;
    case "change":
      return CHANGE_TRANSITIONS;
    default:
      return null;
  }
}
