/**
 * GAP-PAYROLL-DETAIL-02: maker-checker (segregation of duties) for the payroll
 * RUN lifecycle. Pure rules, shared by the synchronous command layer
 * (commands.ts: a 403 the caller sees instead of a 202 the consumer silently
 * drops) and the consumer (re-asserted inside the transaction so a replayed,
 * racing or stale command can never bypass it).
 *
 *   create   -> payroll_admin | payroll_officer | super_admin   (the maker)
 *   approve  -> must NOT be the person who created the run
 *   disburse -> must NOT be the person who approved the run
 *
 * Two distinct people are therefore always enough to release a run
 * (A creates and disburses, B approves); nobody can approve their own work or
 * disburse what they approved. There is deliberately no override: the approve
 * rule has been enforced without one since Iter2 (consumer.ts), and an
 * override would be a policy decision for the owner, not a code default.
 *
 * `approvedBy` may be null on runs approved before the column was recorded;
 * there is nobody to compare against, so the disburse rule cannot fire there.
 */

export const MAKER_CHECKER_VIOLATION = "MAKER_CHECKER_VIOLATION";

export type RunMakerCheckerAction = "approve" | "disburse";

export type RunMakerCheckerRow = {
  createdBy: string | null;
  approvedBy: string | null;
};

export const MAKER_CHECKER_MESSAGES: Record<RunMakerCheckerAction, string> = {
  approve: "a payroll run must be approved by someone other than the person who created it",
  disburse: "a payroll run must be disbursed by someone other than the person who approved it",
};

/** The human message when `actorId` may NOT take `action` on `run`; null when allowed. */
export function runMakerCheckerDenial(
  action: RunMakerCheckerAction,
  actorId: string,
  run: RunMakerCheckerRow,
): string | null {
  if (action === "approve") {
    return run.createdBy !== null && run.createdBy === actorId ? MAKER_CHECKER_MESSAGES.approve : null;
  }
  return run.approvedBy !== null && run.approvedBy === actorId ? MAKER_CHECKER_MESSAGES.disburse : null;
}
