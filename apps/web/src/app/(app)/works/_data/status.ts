/**
 * works feature — canonical proposal lifecycle status vocabulary.
 *
 * Single source of truth for the status keys the works-service dashboard
 * (`GET /api/v1/works/dashboard` → `byStatus`) actually returns. Derived from
 * services/works-service/src/modules/proposal/schema.ts (work_proposals.status
 * column comment: `draft | dao_finalized | ts_eligible`) and confirmed against
 * the status transitions in proposal/consumer.ts.
 *
 * GAP-WORKS-HOME-02: the hub previously read `byStatus["submitted"]` /
 * `byStatus["pending"]` for its "Pending" KPI — neither key is ever present in
 * this vocabulary, so that tile silently showed 0 while real records existed.
 * Pending here means "past draft, not yet closed" = dao_finalized + ts_eligible.
 */
export const PROPOSAL_STATUS = {
  DRAFT: "draft",
  DAO_FINALIZED: "dao_finalized",
  TS_ELIGIBLE: "ts_eligible",
} as const;

export type ProposalStatus = (typeof PROPOSAL_STATUS)[keyof typeof PROPOSAL_STATUS];

/** Statuses that count as "pending" (in-flight) on the hub — everything past draft. */
export const PROPOSAL_PENDING_STATUSES: readonly ProposalStatus[] = [
  PROPOSAL_STATUS.DAO_FINALIZED,
  PROPOSAL_STATUS.TS_ELIGIBLE,
];

/** Sum the pending (in-flight) proposals from a dashboard `byStatus` map. */
export function sumPendingProposals(byStatus: Record<string, number>): number {
  return PROPOSAL_PENDING_STATUSES.reduce((acc, s) => acc + (byStatus[s] ?? 0), 0);
}

/** The draft count from a dashboard `byStatus` map. */
export function draftProposals(byStatus: Record<string, number>): number {
  return byStatus[PROPOSAL_STATUS.DRAFT] ?? 0;
}
