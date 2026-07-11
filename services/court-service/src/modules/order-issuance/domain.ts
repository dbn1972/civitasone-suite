/**
 * order-issuance pure domain — the order issuance state machine and the
 * maker-checker guard (§23 + §35.5 "AI never auto-issues"). No I/O — every
 * function here is deterministic and side-effect free so it is trivially
 * unit-testable and safe to call from both the command and consumer paths.
 */

export const ISSUANCE_STATUSES = [
  "draft",
  "pending_approval",
  "issued",
  "recalled",
] as const;
export type IssuanceStatus = typeof ISSUANCE_STATUSES[number];

/**
 * Order issuance lifecycle (maker-checker + DSC pronouncement):
 *   draft ──▶ pending_approval   (maker submits the drafted order for approval)
 *   pending_approval ──▶ issued  (a DIFFERENT checker approves + DSC-signs → pronounced)
 *   pending_approval ──▶ draft   (checker sends it back to the maker for revision)
 *   issued ──▶ recalled          (an already-issued order is withdrawn, with a reason)
 *
 * Terminal: `recalled` has no onward transition. `issued` is effectively final
 * except for the single recall edge.
 */
const TRANSITIONS: Record<IssuanceStatus, IssuanceStatus[]> = {
  draft:            ["pending_approval"],
  pending_approval: ["issued", "draft"],
  issued:           ["recalled"],
  recalled:         [],
};

export function canTransition(from: IssuanceStatus, to: IssuanceStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: IssuanceStatus): void {
  if (!canTransition(from as IssuanceStatus, to)) {
    throw new Error(`INVALID_ISSUANCE_TRANSITION: cannot move order from '${from}' to '${to}'`);
  }
}

/** Terminal states have no onward transition. `recalled` is terminal; `issued`
 *  is final except for recall (still allows the recall edge, so not terminal). */
export function isTerminal(status: IssuanceStatus): boolean {
  return status === "recalled";
}

/**
 * MAKER-CHECKER guard (§23 + §35.5). Throws when the approver/issuer is the SAME
 * person as the order's maker — the person who drafts an order can never be the
 * person who approves and issues it. The compare is case-insensitive and
 * whitespace-trimmed so cosmetic id formatting differences cannot defeat it. A
 * missing/blank id on either side is itself a violation (fail-closed): an order
 * with no identifiable maker cannot be self-approved into existence.
 */
export function assertDifferentApprover(makerId: string | null | undefined, approverId: string | null | undefined): void {
  const maker = (makerId ?? "").trim().toLowerCase();
  const approver = (approverId ?? "").trim().toLowerCase();
  if (maker === "" || approver === "") {
    throw new Error(
      "MAKER_CHECKER_VIOLATION: both a maker and a distinct approver identity are required to issue an order",
    );
  }
  if (maker === approver) {
    throw new Error(
      `MAKER_CHECKER_VIOLATION: the approver/issuer (${approverId}) must be a different person from the order's maker`,
    );
  }
}
