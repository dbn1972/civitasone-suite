/**
 * SVC-046 — PO / Work-order amendment, change-order versioning, milestone and
 * closure domain logic. Pure functions (no I/O).
 */

export class AmendmentDomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "AmendmentDomainError";
  }
}

export const ORDER_TYPES = ["supply", "service", "work"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const AMENDMENT_TYPES = ["quantity", "price", "schedule", "scope", "change_order"] as const;
export type AmendmentType = (typeof AMENDMENT_TYPES)[number];

export type AmendmentStatus = "pending" | "approved" | "rejected";
export type MilestoneStatus = "pending" | "in_progress" | "delivered" | "delayed" | "closed";

const AMENDMENT_TRANSITIONS: Record<AmendmentStatus, AmendmentStatus[]> = {
  pending:  ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function assertAmendmentTransition(from: string, to: AmendmentStatus): void {
  const allowed = AMENDMENT_TRANSITIONS[from as AmendmentStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new AmendmentDomainError("INVALID_TRANSITION", `amendment cannot transition from '${from}' to '${to}'`);
  }
}

const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  pending:     ["in_progress", "delivered", "delayed", "closed"],
  in_progress: ["delivered", "delayed", "closed"],
  delayed:     ["in_progress", "delivered", "closed"],
  delivered:   ["closed"],
  closed:      [],
};

export function assertMilestoneTransition(from: string, to: MilestoneStatus): void {
  const allowed = MILESTONE_TRANSITIONS[from as MilestoneStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new AmendmentDomainError("INVALID_TRANSITION", `milestone cannot transition from '${from}' to '${to}'`);
  }
}

/** Maker-checker: amendment approver (checker) must differ from requester (maker). */
export function assertDistinctMakerChecker(makerId: string, checkerId: string): void {
  if (makerId && checkerId && makerId === checkerId) {
    throw new AmendmentDomainError("SOD_VIOLATION", "maker and checker must be different actors (self-approval rejected)");
  }
}

/** Next monotonic amendment/milestone number from the current max (0 → 1). */
export function nextSeq(currentMax: number | null | undefined): number {
  return (currentMax ?? 0) + 1;
}

export interface ChangeOrderResult {
  deltaMinor: bigint;
  prevTotalMinor: bigint;
  newTotalMinor: bigint;
}

/**
 * Compute the value effect of a change order. `deltaMinor` may be negative
 * (reduction) or positive (addition). The resulting new total must not go below
 * zero — a change order cannot make a PO net-negative.
 */
export function computeChangeOrder(currentTotalMinor: bigint, deltaMinor: bigint): ChangeOrderResult {
  const prev = BigInt(currentTotalMinor);
  const newTotal = prev + BigInt(deltaMinor);
  if (newTotal < 0n) {
    throw new AmendmentDomainError("NEGATIVE_TOTAL", "amendment would make PO total negative");
  }
  return { deltaMinor: BigInt(deltaMinor), prevTotalMinor: prev, newTotalMinor: newTotal };
}

/** An amendment is only permitted while the PO is in an amendable state. */
export function assertPoAmendable(poStatus: string): void {
  const amendable = ["approved", "dispatched", "gem_placed"];
  if (!amendable.includes(poStatus)) {
    throw new AmendmentDomainError("PO_NOT_AMENDABLE", `PO in status '${poStatus}' cannot be amended`);
  }
}

/**
 * A PO/work order may be closed only from a fulfilled state and only when every
 * milestone is terminal (delivered or closed). Prevents premature closure while
 * deliverables are outstanding.
 */
export function assertClosable(poStatus: string, milestoneStatuses: string[]): void {
  const closableFrom = ["approved", "dispatched", "gem_placed"];
  if (!closableFrom.includes(poStatus)) {
    throw new AmendmentDomainError("PO_NOT_CLOSABLE", `PO in status '${poStatus}' cannot be closed`);
  }
  const open = milestoneStatuses.filter((s) => s !== "delivered" && s !== "closed");
  if (open.length > 0) {
    throw new AmendmentDomainError("MILESTONES_OPEN", `cannot close PO with ${open.length} unfulfilled milestone(s)`);
  }
}
