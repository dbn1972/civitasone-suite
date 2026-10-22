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
 *
 * This module is also the ONE home of the rest of the stage vocabulary the CRM
 * deals screens share (GAP-CRM-DEALS-NEW-02): the canonical keys the mapper
 * normalises to, the lower-case alias table, the capitalised wire stages of the
 * CRM summary mapper, the open-path used by the detail workflow, and the
 * list's key -> i18n label map. apiMappers, DealsTable and the detail page
 * import from here instead of each keeping its own copy.
 */
import type { CRMDealSummary, DealSummary } from "@civitasone/types";

/** Canonical lower-case snake stage keys the list/detail screens work in. */
export type DealStageKey = DealSummary["stage"];

export const DEAL_STAGE_KEYS: readonly DealStageKey[] = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

/**
 * Aliases (after lower-casing and space -> underscore) the API or legacy rows
 * may carry for a canonical stage. "qualification" is itself canonical, so it is
 * not an alias.
 */
const DEAL_STAGE_ALIASES: Readonly<Record<string, DealStageKey>> = {
  lead: "prospecting",
  won: "closed_won",
  lost: "closed_lost",
};

/**
 * Normalise a raw API stage ("Lead", "Closed Won", "closed_lost", ...) to its
 * canonical key. null/empty -> null (row is dropped by the mapper); an unknown
 * stage falls back to "prospecting" so a new backend stage never hides a deal.
 */
export function normalizeDealStage(raw: string | null): DealStageKey | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if ((DEAL_STAGE_KEYS as readonly string[]).includes(lower)) return lower as DealStageKey;
  return DEAL_STAGE_ALIASES[lower] ?? "prospecting";
}

/** The open (non-terminal) path the detail workflow walks, in order. */
export const OPEN_STAGE_PATH = ["prospecting", "qualification", "proposal", "negotiation"] as const;

/** Canonical stage key -> crmDealsTable i18n label key (Won -> Concluded, Lost -> Lapsed). */
export const DEAL_STAGE_LABEL_KEYS: Readonly<Record<DealStageKey, string>> = {
  prospecting: "stageProspecting",
  qualification: "stageQualification",
  proposal: "stageProposal",
  negotiation: "stageNegotiation",
  closed_won: "stageConcluded",
  closed_lost: "stageLapsed",
};

/** The capitalised wire vocabulary crm-service accepts and the CRM summary mapper emits. */
export const DEAL_WIRE_STAGES: readonly CRMDealSummary["stage"][] = ["Lead", "Proposal", "Negotiation", "Won", "Lost"] as const;

/**
 * Raw stage -> capitalised wire stage for CRMDealSummary: "lead" -> "Lead", an
 * already-wire value is kept, anything else is capitalised. Null/empty -> null.
 */
export function toWireStage(raw: string | null): CRMDealSummary["stage"] | null {
  if (!raw) return null;
  if (raw === "lead") return "Lead";
  if ((DEAL_WIRE_STAGES as readonly string[]).includes(raw)) return raw as CRMDealSummary["stage"];
  return (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()) as CRMDealSummary["stage"];
}

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
