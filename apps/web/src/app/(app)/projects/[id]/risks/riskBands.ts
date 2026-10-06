import type { PillVariant } from "@/app/_components/ds/StatusPill";

// GAP-PROJECTS-DETAIL-RISKS-02: the score bands were hard-coded inline (>=9
// critical, >=4 amber) with no legend, so "Critical" could not be reconciled
// with the row's probability×impact. They now live in one place with a legend
// rendered under the table. Thresholds assume a 1–5 probability × 1–5 impact
// matrix (max 25). FLAGGED FOR HUMAN REVIEW: confirm the exact bands with the
// PMU; this is the safest documented default, not a verified product rule.
export const RISK_BANDS = {
  criticalMin: 9,
  mediumMin: 4,
} as const;

export type RiskBand = "critical" | "medium" | "low";

export function scoreBand(score: number): RiskBand {
  if (score >= RISK_BANDS.criticalMin) return "critical";
  if (score >= RISK_BANDS.mediumMin) return "medium";
  return "low";
}

export const RISK_SCORE_LEGEND =
  `Score = probability × impact (1–5 each). ` +
  `${RISK_BANDS.criticalMin}+ critical, ${RISK_BANDS.mediumMin}–${RISK_BANDS.criticalMin - 1} medium, below ${RISK_BANDS.mediumMin} low.`;

// GAP-PROJECTS-DETAIL-RISKS-03/04: in a RISK register "open" is an unresolved,
// attention-needing state — the opposite of the app-wide StatusPill default
// where "open" maps to the green "good" tone (correct for a ticket/req). Pass
// these as an explicit StatusPill `variant` override so the risk register's
// colours are right WITHOUT recolouring "open" globally for other modules.
const RISK_STATUS_TONE: Record<string, PillVariant> = {
  open: "bad",
  occurred: "bad",
  mitigated: "good",
  closed: "mut",
};

/** Explicit pill tone for a risk status, or undefined to fall back to the global map. */
export function riskStatusVariant(status: string): PillVariant | undefined {
  return RISK_STATUS_TONE[status.trim().toLowerCase()];
}

/** Pill tone for a risk score band (critical→bad, medium→warn, low→good). */
export function riskScoreVariant(score: number): PillVariant {
  const band = scoreBand(score);
  return band === "critical" ? "bad" : band === "medium" ? "warn" : "good";
}
