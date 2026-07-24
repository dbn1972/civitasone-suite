/**
 * SVC-126 — pure domain logic for the governed policy/SOP/circular lifecycle.
 *
 * No I/O here: lifecycle transition rules, maker-checker enforcement,
 * effective-date evaluation, acknowledgement rollups and periodic-review
 * scheduling are all pure functions so they can be exhaustively unit-tested.
 */

export type PolicyStatus =
  | "draft"
  | "under_review"
  | "approved"
  | "published"
  | "superseded"
  | "withdrawn";

export type DocType = "sop" | "policy" | "circular";

/** Allowed forward/backward transitions for the lifecycle state machine. */
export const TRANSITIONS: Record<PolicyStatus, PolicyStatus[]> = {
  draft: ["under_review", "withdrawn"],
  under_review: ["approved", "draft", "withdrawn"],
  approved: ["published", "under_review", "withdrawn"],
  published: ["superseded", "withdrawn"],
  superseded: [],
  withdrawn: [],
};

export type LifecycleCode = "INVALID_TRANSITION" | "MAKER_CHECKER" | "NOT_FOUND" | "INVALID_STATE";

export class LifecycleError extends Error {
  constructor(public readonly code: LifecycleCode, message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

export function canTransition(from: PolicyStatus, to: PolicyStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: PolicyStatus, to: PolicyStatus): void {
  if (!canTransition(from, to)) {
    throw new LifecycleError("INVALID_TRANSITION", `cannot transition ${from} → ${to}`);
  }
}

/**
 * Maker-checker: the approver (and publisher) must be a different person from
 * the author who drafted the document. Rejects self-approval.
 */
export function assertApproverDistinct(authorId: string, approverId: string): void {
  if (authorId === approverId) {
    throw new LifecycleError("MAKER_CHECKER", "approver must differ from the author (maker-checker)");
  }
}

/**
 * A document is "in force" when it is published and its effective date (if any)
 * is not in the future relative to `asOf`.
 */
export function isEffective(
  p: { status: PolicyStatus; effectiveDate: string | null },
  asOf: Date,
): boolean {
  if (p.status !== "published") return false;
  if (!p.effectiveDate) return true;
  return new Date(`${p.effectiveDate}T00:00:00Z`).getTime() <= asOf.getTime();
}

export interface AckRollup {
  total: number;
  acknowledged: string[];
  pending: string[];
  acknowledgedCount: number;
  pendingCount: number;
  rate: number;
}

/**
 * Who-has / who-hasn't acknowledged. Given the expected roster and the set of
 * employees who acknowledged, returns the split plus the completion rate (%).
 */
export function acknowledgementRollup(expected: string[], ackedEmployeeIds: string[]): AckRollup {
  const ackedSet = new Set(ackedEmployeeIds);
  const uniqExpected = [...new Set(expected)];
  const acknowledged = uniqExpected.filter((e) => ackedSet.has(e));
  const pending = uniqExpected.filter((e) => !ackedSet.has(e));
  const total = uniqExpected.length;
  const rate = total === 0 ? 0 : Math.round((acknowledged.length / total) * 1000) / 10;
  return {
    total,
    acknowledged,
    pending,
    acknowledgedCount: acknowledged.length,
    pendingCount: pending.length,
    rate,
  };
}

/** True when a published document has reached (or passed) its periodic review date. */
export function isReviewDue(
  p: { status: PolicyStatus; reviewDueDate: string | null },
  asOf: Date,
): boolean {
  if (p.status !== "published") return false;
  if (!p.reviewDueDate) return false;
  return new Date(`${p.reviewDueDate}T00:00:00Z`).getTime() <= asOf.getTime();
}

/** Compute a review-due date `months` after the effective date (ISO yyyy-mm-dd). */
export function computeReviewDueDate(effective: string, months: number): string {
  const d = new Date(`${effective}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
