/**
 * executions/domain.ts — Execution state machine and progress tracking.
 *
 * States: enrolled → in_progress → completed / exited
 */

export type ExecutionStatus = "enrolled" | "in_progress" | "completed" | "exited";

const EXECUTION_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  enrolled: ["in_progress", "exited"],
  in_progress: ["completed", "exited"],
  completed: [],
  exited: [],
};

/**
 * Validate execution status transition.
 */
export function validateExecutionTransition(from: ExecutionStatus, to: ExecutionStatus): string | null {
  const allowed = EXECUTION_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return `cannot transition execution from '${from}' to '${to}'`;
  }
  return null;
}

/**
 * Determine the next status based on step completion.
 * If currentStepIndex >= totalSteps - 1, journey is completed.
 */
export function computeNextStatus(currentStepIndex: number, totalSteps: number): ExecutionStatus {
  if (currentStepIndex >= totalSteps - 1) {
    return "completed";
  }
  return "in_progress";
}

/**
 * Check if an execution is in a terminal state.
 */
export function isTerminal(status: ExecutionStatus): boolean {
  return status === "completed" || status === "exited";
}

/**
 * Validate that a profile can be enrolled in a journey.
 * Returns null if valid, error message otherwise.
 */
export function validateEnrollment(journeyStatus: string): string | null {
  if (journeyStatus !== "active") {
    return `cannot enroll in a journey with status '${journeyStatus}'; journey must be 'active'`;
  }
  return null;
}
