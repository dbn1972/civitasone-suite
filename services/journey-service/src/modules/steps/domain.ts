/**
 * steps/domain.ts — Step type validation and execution logic.
 *
 * Step types: send_notification, wait, condition_check, api_call
 * Step statuses: pending → executing → completed / failed / skipped
 */

export type StepType = "send_notification" | "wait" | "condition_check" | "api_call";
export type StepStatus = "pending" | "executing" | "completed" | "failed" | "skipped";

const VALID_STEP_TYPES: StepType[] = ["send_notification", "wait", "condition_check", "api_call"];

const STEP_STATUS_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  pending: ["executing"],
  executing: ["completed", "failed", "skipped"],
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
 * Validate step index is within journey bounds.
 */
export function validateStepIndex(stepIndex: number, totalSteps: number): string | null {
  if (stepIndex < 0 || stepIndex >= totalSteps) {
    return `step index ${stepIndex} is out of bounds (journey has ${totalSteps} steps)`;
  }
  return null;
}
