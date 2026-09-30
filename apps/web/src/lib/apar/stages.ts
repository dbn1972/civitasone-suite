/**
 * GAP-HR-APAR-01 / GAP-HR-APAR-05: single source of truth for the APAR /
 * SPARROW workflow's stage order, labels and grouping.
 *
 * Before this file existed, apar/_components/APARFlowCard.tsx carried its
 * own local `STAGES` array matching a completely different, dead status
 * vocabulary (initiated/pending/self_submitted, ro_review/ro_submitted,
 * rv_submitted/under_review/cso_review, accepted/disputed/closed) that the
 * backend (services/hrms-service/src/modules/apar/routes.ts /
 * f3-consumer.ts) has never written -- it only ever writes the seven
 * statuses below. `stageIndex()` therefore always fell through to its `0`
 * default, so every card rendered "stage 1 active" regardless of a
 * record's real status, and apar/page.tsx's stat-card counters (which
 * filtered on that same dead vocabulary) were 0 for everything except
 * Total. apar/[id]/page.tsx separately hard-coded its OWN (correct)
 * `STAGE_LABEL_KEYS` map for the same seven statuses -- two copies that
 * could drift. Both now import from here.
 *
 * DoPT/SPARROW terminology (GAP-HR-APAR-05): the three-way naming split
 * across the old list-card ("Under Review" / "Counter-signing Officer"),
 * the detail page ("Reviewing Officer concurrence") and the backend
 * (`reviewing_officer`) is resolved by using the DoPT terms -- Reporting
 * Officer, Reviewing Officer, Accepting Authority -- everywhere, sourced
 * from this one map.
 */

export type AparStatus =
  | "self_pending"
  | "reporting_officer"
  | "reviewing_officer"
  | "accepting_authority"
  | "disclosed"
  | "representation"
  | "finalised";

/** The real, ordered backend status chain (apar/routes.ts's doc comment). */
export const APAR_STATUSES: readonly AparStatus[] = [
  "self_pending",
  "reporting_officer",
  "reviewing_officer",
  "accepting_authority",
  "disclosed",
  "representation",
  "finalised",
];

function isAparStatus(status: string): status is AparStatus {
  return (APAR_STATUSES as readonly string[]).includes(status);
}

/** Full per-status label, e.g. for the detail page's "Current Stage" line and stage-history rows. */
export const STAGE_LABEL_KEYS: Record<AparStatus, string> = {
  self_pending: "stageSelfPending",
  reporting_officer: "stageReportingOfficer",
  reviewing_officer: "stageReviewingOfficer",
  accepting_authority: "stageAcceptingAuthority",
  disclosed: "stageDisclosed",
  representation: "stageRepresentation",
  finalised: "stageFinalised",
};

/** Returns the translated full stage label for a status, or the raw status text for an unrecognised (legacy) value. */
export function stageLabelKey(status: string): string | null {
  return isAparStatus(status) ? STAGE_LABEL_KEYS[status] : null;
}

export interface AparStageGroup {
  key: string;
  labelKey: string;
  icon: string;
  statuses: readonly AparStatus[];
}

/**
 * Grouped 5-bubble pipeline for the compact APARFlowCard view (fix step 2's
 * "grouped 5" option): Self, Reporting, Reviewing, Accepting, then a single
 * closing group covering disclosed / representation / finalised, since all
 * three are post-acceptance "closing the loop" states that don't need their
 * own bubble in a small card.
 */
export const APAR_STAGE_GROUPS: readonly AparStageGroup[] = [
  { key: "self", labelKey: "stageSelf", icon: "✍️", statuses: ["self_pending"] },
  { key: "reporting", labelKey: "stageRo", icon: "📋", statuses: ["reporting_officer"] },
  { key: "reviewing", labelKey: "stageReviewing", icon: "🔍", statuses: ["reviewing_officer"] },
  { key: "accepting", labelKey: "stageAccepting", icon: "✅", statuses: ["accepting_authority"] },
  { key: "closure", labelKey: "stageClosure", icon: "📨", statuses: ["disclosed", "representation", "finalised"] },
];

/**
 * Index into APAR_STAGE_GROUPS for a record's status. Unknown/legacy status
 * values (e.g. a pre-SPARROW row still holding the old free-form "pending")
 * fall back to `0` (Self) rather than throwing -- see this module's doc
 * comment and GAP-HR-APAR-01's Risk note ("legacy statuses from old rows
 * can be kept as a fallback to stage 0").
 */
export function stageIndex(status: string): number {
  for (let i = 0; i < APAR_STAGE_GROUPS.length; i++) {
    if ((APAR_STAGE_GROUPS[i].statuses as readonly string[]).includes(status)) return i;
  }
  return 0;
}

/** True once the APAR is fully closed (HR has finalised it). */
export function isFinal(status: string): boolean {
  return status === "finalised";
}

/** True while an officer's representation is on file and awaiting HR's finalise. */
export function isRepresentationFiled(status: string): boolean {
  return status === "representation";
}
