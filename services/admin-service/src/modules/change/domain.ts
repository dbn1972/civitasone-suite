/**
 * SVC-130 — pure domain logic for the change/release process.
 *
 * No I/O, no DB, no queue: a deterministic state machine plus the CAB
 * maker-checker, rollback-plan, window-validity and freeze-conflict guards.
 * Every guard throws a `ChangeError` carrying an HTTP status + machine code so
 * the route layer can translate it uniformly.
 */

export type ChangeStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "rolled_back";

export const CHANGE_TYPES = ["standard", "normal", "emergency"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_RISKS = ["low", "medium", "high"] as const;
export type ChangeRisk = (typeof CHANGE_RISKS)[number];

export const PIR_OUTCOMES = ["success", "rolled_back"] as const;
export type PirOutcome = (typeof PIR_OUTCOMES)[number];

/** Terminal states have no outgoing transitions. */
export const TRANSITIONS: Record<ChangeStatus, ChangeStatus[]> = {
  draft: ["submitted"],
  submitted: ["approved", "rejected"],
  approved: ["scheduled"],
  rejected: [],
  scheduled: ["in_progress"],
  in_progress: ["completed", "rolled_back"],
  completed: [],
  rolled_back: [],
};

/** Error carrying an HTTP status + stable machine code for the route layer. */
export class ChangeError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ChangeError";
  }
}

export function canTransition(from: ChangeStatus, to: ChangeStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: ChangeStatus, to: ChangeStatus): void {
  if (!canTransition(from, to)) {
    throw new ChangeError(
      409,
      "INVALID_TRANSITION",
      `cannot move change from '${from}' to '${to}'`,
    );
  }
}

/**
 * Maker-checker: the CAB approver must be a different principal than the person
 * who raised the change. Segregation of duties — a requester can never approve
 * their own change.
 */
export function assertApproverDistinct(requesterId: string, approverId: string): void {
  if (requesterId === approverId) {
    throw new ChangeError(
      409,
      "MAKER_CHECKER_VIOLATION",
      "the CAB approver must differ from the change requester",
    );
  }
}

/** A rollback plan is mandatory before a change can be approved. */
export function assertRollbackPlan(rollbackPlan: string | null | undefined): void {
  if (!rollbackPlan || rollbackPlan.trim().length === 0) {
    throw new ChangeError(
      422,
      "ROLLBACK_REQUIRED",
      "a rollback plan is required before CAB approval",
    );
  }
}

/** The release window must be a positive interval (end strictly after start). */
export function assertValidWindow(start: Date, end: Date): void {
  if (!(end.getTime() > start.getTime())) {
    throw new ChangeError(
      422,
      "INVALID_WINDOW",
      "release window end must be after its start",
    );
  }
}

/** Half-open overlap test: [aStart,aEnd) intersects [bStart,bEnd). */
export function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export type FreezeWindow = { id: string; name: string; startsAt: Date; endsAt: Date };

/** First freeze window that overlaps the proposed release window, if any. */
export function findFreezeConflict(
  start: Date,
  end: Date,
  freezes: readonly FreezeWindow[],
): FreezeWindow | undefined {
  return freezes.find((f) => windowsOverlap(start, end, f.startsAt, f.endsAt));
}

/** A change cannot be scheduled into a window that collides with a freeze. */
export function assertNoFreezeConflict(
  start: Date,
  end: Date,
  freezes: readonly FreezeWindow[],
): void {
  const conflict = findFreezeConflict(start, end, freezes);
  if (conflict) {
    throw new ChangeError(
      409,
      "FREEZE_CONFLICT",
      `release window conflicts with change freeze '${conflict.name}'`,
    );
  }
}

/** Map a PIR outcome to the resulting terminal state. */
export function statusForPir(outcome: PirOutcome): ChangeStatus {
  return outcome === "success" ? "completed" : "rolled_back";
}
