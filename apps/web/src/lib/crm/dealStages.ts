/**
 * GAP-CRM-DEALS-NEW-02: a single source of truth for the deal stages the
 * manual "New engagement" capture screen may create a deal in. The stage
 * vocabulary was duplicated across the create form, the list/detail pages and
 * apiMappers.normalizeDealStage, which let them drift (the form offered
 * capitalised Lead/Proposal/… while the list used snake-case canonical keys,
 * and "qualification" existed in the mapper but nowhere in the form).
 *
 * CONTRACT DECISION (recorded here, not stalled): services/crm-service's deals
 * API returns and accepts CAPITALISED stage values ("Lead", "Proposal",
 * "Negotiation", "Won", "Lost") — this is stated explicitly in
 * loaders.getDealById's comment and is what apiMappers.normalizeDealStage maps
 * FROM. So the wire `value` sent on create is the capitalised form; `canonical`
 * is the lower-case snake key the UI normalises to for display, matching
 * DealSummary["stage"]. crm-service is present in this worktree but the deals
 * module's create route was not exhaustively re-derived here; if the service
 * ever switches to snake-case canonical input, change `value` to equal
 * `canonical` in one place.
 *
 * Only OPEN stages are offered on create — Won/Lost are terminal outcomes of
 * the governed close flow (see GAP-CRM-DEALS-NEW-01 in new/page.tsx), never a
 * starting state. "Qualification" is a valid canonical stage in the mapper but
 * is intentionally NOT a create option: the HIGH-batch GAP-CRM-DEALS-NEW-01
 * decision pinned the create set to Lead/Proposal/Negotiation, and its test
 * asserts exactly that. Keeping it here would reintroduce a mismatch and break
 * that pinned test; a deal reaches Qualification by progressing, not at capture.
 */
export type DealStageOption = {
  /** The value POSTed to the deals API (capitalised wire form). */
  value: string;
  /** The human label shown in the <select>. */
  label: string;
  /** The canonical lower-case snake key the list/detail normalise to. */
  canonical: "prospecting" | "qualification" | "proposal" | "negotiation";
};

export const DEAL_STAGES: readonly DealStageOption[] = [
  { value: "Lead", label: "Lead", canonical: "prospecting" },
  { value: "Proposal", label: "Proposal", canonical: "proposal" },
  { value: "Negotiation", label: "Negotiation", canonical: "negotiation" },
] as const;

/** Stage-to-default-probability band (GAP-CRM-DEALS-NEW-05). Editable by the
 * user afterwards; this is only the sensible starting value when the stage
 * changes, so a Lead does not start at 0% and a Negotiation does not start low. */
export const STAGE_DEFAULT_PROBABILITY: Record<string, number> = {
  Lead: 10,
  Proposal: 40,
  Negotiation: 70,
};
