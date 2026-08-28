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

export interface ResolvedStep {
  stepType: string;
  stepConfig: Record<string, unknown>;
}

/**
 * Pull a step's declared type + config out of a journey definition's stored
 * `steps` array (jsonb, untyped at rest). Returns null when the index is out
 * of bounds or the step has no string `type` — callers must treat that as
 * "this step cannot be dispatched," never default to some assumed type.
 *
 * Shared by the manual execute-step route and the executions consumer's
 * auto-chain to the next step, so both entry points resolve a step definition
 * identically.
 */
export function resolveStep(steps: Array<Record<string, unknown>>, stepIndex: number): ResolvedStep | null {
  const step = steps[stepIndex];
  if (!step || typeof step["type"] !== "string") return null;
  const rawConfig = step["config"];
  const stepConfig =
    rawConfig !== null && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>)
      : {};
  return { stepType: step["type"], stepConfig };
}
