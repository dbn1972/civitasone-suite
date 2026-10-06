// GAP-PROCUREMENT-GRN-01 — one canonical set of GRN status labels shared by the
// list page and the detail page, so a status like `under_inspection` can never
// show its raw snake_case form in one place while being labelled in the other.
// Previously the list page omitted `under_inspection` entirely (it fell through
// to the raw string) while the detail page carried its own copy.
export const GRN_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  under_inspection: "Under Inspection",
  received: "Received",
  quality_check: "Quality Check",
  accepted: "Accepted",
  partially_rejected: "Partially Rejected",
  rejected: "Rejected",
};

export function grnStatusLabel(status: string): string {
  return GRN_STATUS_LABELS[status] ?? status;
}

// GAP-PROCUREMENT-GRN-01 — the GRN statuses that are still awaiting a quality
// decision. The detail page treats `draft` and `under_inspection` as the
// inspectable states (canInspectGrn); `received`/`quality_check` are legacy
// in-flight states that also precede acceptance. These are the states the
// "Awaiting inspection" stat card counts, so a GRN sitting in any pre-decision
// state is visible in the count rather than silently excluded.
export const GRN_AWAITING_INSPECTION_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "under_inspection",
  "received",
  "quality_check",
]);

export function isAwaitingInspection(status: string): boolean {
  return GRN_AWAITING_INSPECTION_STATUSES.has(status);
}

// GAP-PROCUREMENT-GRN-04 / GRN-DETAIL-02 — the three match states a GRN can be
// in, shared by both pages so the same GRN never reads differently in each.
// `undefined` (match not yet computed, i.e. uninspected) is a neutral "pending"
// state — NOT a red mismatch.
export type MatchState = "matched" | "mismatch" | "pending";

export function matchState(threeWayMatch: boolean | undefined): MatchState {
  if (threeWayMatch === undefined) return "pending";
  return threeWayMatch ? "matched" : "mismatch";
}

export const MATCH_LABELS: Record<MatchState, string> = {
  matched: "Matched",
  mismatch: "Mismatch",
  pending: "Pending",
};

/** StatusPill status key for a match state (coloured pill, text label kept). */
export const MATCH_PILL_STATUS: Record<MatchState, string> = {
  matched: "accepted",
  mismatch: "rejected",
  pending: "pending",
};

// DataTable `cellType: "status"` reads the cell value as the StatusPill status
// key and looks that key up in `statusLabels` for the display text. The match
// cell stores a pill key (accepted/rejected/pending), so the label map must be
// keyed by those pill keys — not by MatchState.
export const MATCH_STATUS_LABELS: Record<string, string> = {
  accepted: "Matched",
  rejected: "Mismatch",
  pending: "Pending",
};
