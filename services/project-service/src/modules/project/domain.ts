export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";
export type TaskStatus    = "pending" | "in_progress" | "completed" | "blocked";

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending:     ["in_progress", "blocked"],
  in_progress: ["completed", "blocked", "pending"],
  blocked:     ["pending", "in_progress"],
  completed:   [],
};

export function assertTaskTransitionAllowed(from: string, to: string): void {
  const allowed = TASK_TRANSITIONS[from as TaskStatus] ?? [];
  if (!allowed.includes(to as TaskStatus)) {
    throw new DomainError("INVALID_TRANSITION", `task cannot transition from '${from}' to '${to}'`);
  }
}

export function assertMilestoneCanComplete(status: string): void {
  if (status !== "pending") {
    throw new DomainError("MILESTONE_NOT_PENDING", `milestone status is '${status}', must be pending to complete`);
  }
}
