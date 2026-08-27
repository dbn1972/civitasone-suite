export const REQUEST_TYPES = ["transfer", "cancellation", "eviction"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_STATUSES = ["submitted", "under_review", "approved", "rejected", "completed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// NOTE: "under_review" is modeled but unreachable — no command in this module
// ever moves a request into it (there's no "start review" step), only
// approveRequest/rejectRequest exist, and routes.ts's own pre-check already
// allowed approving/rejecting directly from "submitted" (confirmed by reading
// routes.ts before this fix: `!["submitted","under_review"].includes(...)`).
// submitted -> approved/rejected reflects what's actually implemented;
// under_review stays modeled for forward-compatibility if a review step is
// ever added, matching the same "don't invent unreachable-precondition bugs"
// judgment call made for permits/domain.ts's PERMIT_ELIGIBLE_APPLICATION_STATUSES
// in the companion event-service PR.
const VALID_TRANSITIONS: Record<string, RequestStatus[]> = {
  submitted: ["under_review", "approved", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["completed"],
  rejected: [],
  completed: [],
};

export function canTransition(from: string, to: RequestStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Statuses a lifecycle request may currently be in for `to` to be legal next,
 * derived from VALID_TRANSITIONS (same table canTransition uses). Passed to
 * repo.updateStatus's `fromStatuses` for the atomic WHERE-clause guard.
 */
export function fromStatusesFor(to: RequestStatus): RequestStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as RequestStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
}

export function generateRequestNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `MKT-LC/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
