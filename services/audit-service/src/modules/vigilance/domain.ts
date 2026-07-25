/**
 * SVC-096 Vigilance — pure domain: case-stage transitions, screening decision,
 * and the maker-checker guard for an action recommendation decision.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type VigilanceStage =
  | "intake"
  | "screening"
  | "assigned"
  | "under_investigation"
  | "findings"
  | "action_recommended"
  | "closed";

export type ScreeningStatus = "pending" | "admitted" | "rejected";
export type ActionStatus = "proposed" | "approved" | "rejected";

const STAGE_TRANSITIONS: Record<VigilanceStage, VigilanceStage[]> = {
  intake: ["screening", "closed"],
  screening: ["assigned", "closed"],
  assigned: ["under_investigation", "closed"],
  under_investigation: ["findings", "closed"],
  findings: ["action_recommended", "closed"],
  action_recommended: ["closed"],
  closed: [],
};

export function assertStageTransition(from: VigilanceStage, to: VigilanceStage): void {
  if (!STAGE_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError("INVALID_STAGE", `cannot move vigilance case from ${from} to ${to}`);
  }
}

/** Screening (admission) can only happen out of intake/screening. */
export function assertCanScreen(stage: VigilanceStage): void {
  if (stage !== "intake" && stage !== "screening") {
    throw new DomainError("INVALID_STAGE", `screening not allowed from stage ${stage}`);
  }
}

/** An IO can only be assigned to an admitted case. */
export function assertCanAssignIo(screening: ScreeningStatus): void {
  if (screening !== "admitted") {
    throw new DomainError("NOT_ADMITTED", "an IO can only be assigned after the complaint is admitted on screening");
  }
}

/**
 * Maker-checker guard: the disciplinary authority approving/rejecting an action
 * recommendation must not be the same officer who proposed it. Enforced
 * server-side at decision time.
 */
export function assertDifferentActor(makerId: string, checkerId: string, subject = "action"): void {
  if (!checkerId) {
    throw new DomainError("CHECKER_REQUIRED", `${subject} requires a deciding authority`);
  }
  if (makerId === checkerId) {
    throw new DomainError("MAKER_CHECKER_VIOLATION", `${subject} must be decided by a different authority than the one who proposed it`);
  }
}
