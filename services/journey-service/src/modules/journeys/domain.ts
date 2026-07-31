/**
 * journeys/domain.ts — Journey lifecycle state machine and validation rules.
 *
 * State machine: draft → active → paused → active (re-activate) → completed → archived
 * Only "draft" journeys may be edited (name, steps, triggers).
 */

export type JourneyStatus = "draft" | "active" | "paused" | "completed" | "archived";

/** Valid transitions from each state. */
const TRANSITIONS: Record<JourneyStatus, JourneyStatus[]> = {
  draft: ["active", "archived"],
  active: ["paused", "completed", "archived"],
  paused: ["active", "completed", "archived"],
  completed: ["archived"],
  archived: [],
};

/**
 * Check whether a status transition is valid.
 * Returns null if valid, or an error message if invalid.
 */
export function validateTransition(from: JourneyStatus, to: JourneyStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return `cannot transition from '${from}' to '${to}'`;
  }
  return null;
}

/**
 * Validate that a journey can be activated.
 * Requires at least one step defined.
 */
export function validateActivation(steps: Array<Record<string, unknown>>): string | null {
  if (!steps || steps.length === 0) {
    return "journey must have at least one step to be activated";
  }
  return null;
}

/**
 * Validate that a journey can be edited (name, steps, trigger config).
 * Only draft journeys are editable.
 */
export function validateEditable(status: JourneyStatus): string | null {
  if (status !== "draft") {
    return `cannot edit a journey in '${status}' status; only 'draft' journeys are editable`;
  }
  return null;
}

/**
 * Validate journey creation input.
 */
export function validateCreate(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return "journey name is required";
  }
  if (name.length > 200) {
    return "journey name must be at most 200 characters";
  }
  return null;
}
