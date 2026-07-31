/**
 * tasks/domain.ts — Pure business logic for field task lifecycle.
 * State machine: unassigned → assigned → in_progress → completed | cancelled.
 * Priority scoring, SLA breach detection, assignment validation.
 */

export type TaskStatus = "unassigned" | "assigned" | "in_progress" | "completed" | "cancelled";

/** Valid transitions in the task lifecycle state machine. */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  unassigned: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled", "unassigned"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * Check whether a status transition is valid.
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Validate a status transition. Returns an error string or null if valid.
 */
export function validateTransition(from: TaskStatus, to: TaskStatus): string | null {
  if (!isValidTransition(from, to)) {
    return `invalid transition: ${from} → ${to}`;
  }
  return null;
}

export interface PriorityInput {
  /** Task priority level 1-5 (1 = highest). */
  priority: number;
  /** Due date ISO string (nullable). */
  dueDate: string | null;
  /** Whether the task location is in a high-density area. */
  highDensityArea?: boolean;
}

/**
 * Calculate a priority score for sorting/scheduling.
 * Higher score = more urgent. Range: 0–100.
 */
export function calculatePriorityScore(input: PriorityInput): number {
  // Base score from priority level (inverted: priority 1 = 50 pts, priority 5 = 10 pts)
  const baseScore = Math.max(10, 60 - (input.priority - 1) * 12.5);

  // Urgency bonus from due date proximity
  let urgencyBonus = 0;
  if (input.dueDate) {
    const now = Date.now();
    const due = new Date(input.dueDate).getTime();
    const hoursRemaining = (due - now) / (1000 * 60 * 60);
    if (hoursRemaining <= 0) {
      urgencyBonus = 30; // overdue
    } else if (hoursRemaining <= 4) {
      urgencyBonus = 25;
    } else if (hoursRemaining <= 12) {
      urgencyBonus = 15;
    } else if (hoursRemaining <= 24) {
      urgencyBonus = 10;
    }
  }

  // Area density bonus
  const densityBonus = input.highDensityArea ? 5 : 0;

  return Math.min(100, baseScore + urgencyBonus + densityBonus);
}

export interface SlaInput {
  /** Due date ISO string. */
  dueDate: string;
  /** Current status. */
  status: TaskStatus;
  /** Completed time ISO (if completed). */
  completedAt?: string | null;
}

/**
 * Detect SLA breach. Returns breach info or null.
 */
export function detectSlaBreach(input: SlaInput): { breached: boolean; overdueMinutes: number } | null {
  if (!input.dueDate) return null;

  const due = new Date(input.dueDate).getTime();

  // If completed, check against completion time
  if (input.status === "completed" && input.completedAt) {
    const completed = new Date(input.completedAt).getTime();
    if (completed > due) {
      return { breached: true, overdueMinutes: Math.ceil((completed - due) / (1000 * 60)) };
    }
    return { breached: false, overdueMinutes: 0 };
  }

  // If cancelled, no SLA applies
  if (input.status === "cancelled") return null;

  // For active tasks, check current time
  const now = Date.now();
  if (now > due) {
    return { breached: true, overdueMinutes: Math.ceil((now - due) / (1000 * 60)) };
  }

  return { breached: false, overdueMinutes: 0 };
}

/**
 * Validate that an assignment is valid.
 * - Cannot assign to same person who is already the assignee
 * - Cannot assign if task is completed or cancelled
 */
export function validateAssignment(
  currentStatus: TaskStatus,
  currentAssigneeId: string | null,
  newAssigneeId: string,
): string | null {
  if (currentStatus === "completed" || currentStatus === "cancelled") {
    return `cannot assign: task is ${currentStatus}`;
  }
  if (currentAssigneeId === newAssigneeId) {
    return "cannot assign: already assigned to this agent";
  }
  return null;
}
