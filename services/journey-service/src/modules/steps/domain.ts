/**
 * steps/domain.ts — Step type validation and execution logic.
 *
 * Step types: send_notification, wait, condition_check, api_call
 *   Each type's dispatch (and its config contract) lives in ./dispatch.ts.
 * Step statuses: pending → executing → completed / failed / skipped
 *   `waiting` is the parked state of a `wait` step: the run stops there until
 *   resume_at elapses and the wait sweeper resumes it.
 */

export type StepType = "send_notification" | "wait" | "condition_check" | "api_call";
export type StepStatus = "pending" | "executing" | "waiting" | "completed" | "failed" | "skipped";

/** The step types this service actually dispatches. Single source of truth. */
export const STEP_TYPES = ["send_notification", "wait", "condition_check", "api_call"] as const;

const VALID_STEP_TYPES: StepType[] = [...STEP_TYPES];

const STEP_STATUS_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  pending: ["executing", "waiting"],
  executing: ["waiting", "completed", "failed", "skipped"],
  waiting: ["executing", "completed", "failed", "skipped"],
  completed: [],
  failed: [],
  skipped: [],
};

/**
 * Validate a step type string.
 */
export function validateStepType(stepType: string): string | null {
  if (!VALID_STEP_TYPES.includes(stepType as StepType)) {
    return `invalid step type '${stepType}'; must be one of: ${VALID_STEP_TYPES.join(", ")}`;
  }
  return null;
}

/**
 * Validate step status transition.
 */
export function validateStepTransition(from: StepStatus, to: StepStatus): string | null {
  const allowed = STEP_STATUS_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return `cannot transition step from '${from}' to '${to}'`;
  }
  return null;
}

/**
 * Determine if a step execution result should advance the journey
 * (i.e., the step is terminal and successful).
 */
export function isStepTerminal(status: StepStatus): boolean {
  return status === "completed" || status === "failed" || status === "skipped";
}

/**
 * A parked `wait` step: not terminal, but not making progress either. The run
 * resumes only when the sweeper finds its resume_at due.
 */
export function isStepParked(status: StepStatus): boolean {
  return status === "waiting";
}

/**
 * Validate step index is within journey bounds.
 */
export function validateStepIndex(stepIndex: number, totalSteps: number): string | null {
  if (stepIndex < 0 || stepIndex >= totalSteps) {
    return `step index ${stepIndex} is out of bounds (journey has ${totalSteps} steps)`;
  }
  return null;
}
