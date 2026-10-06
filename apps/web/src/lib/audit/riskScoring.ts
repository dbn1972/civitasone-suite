// GAP-AUDIT-RISK-REGISTER-01/02/03/05: single source of truth for the risk
// register's display scoring and labels, so the page tiles, the table rating
// pill, the segmented band filter and the Add-Risk dialog preview all agree.
//
// The numeric score mirrors the audit-service formula exactly
// (services/audit-service/src/modules/risk/domain.ts: computeRiskScore =
// LIKELIHOOD_WEIGHT[l] * IMPACT_WEIGHT[i], each ordinal 1..5), so a live
// client-side preview can never diverge from what the server stores.
//
// The 3-tier display bands (High >=15, Medium >=6, else Low) match the bands
// the register UI has always shown (page.tsx + RiskTable ratingPill). They are
// a presentation banding and intentionally distinct from the 4-tier
// riskBand()/HIGH_RISK_THRESHOLD used by the audit-universe selector server-side.

export type Likelihood = "rare" | "unlikely" | "possible" | "likely" | "almost_certain";
export type Impact = "negligible" | "minor" | "moderate" | "major" | "catastrophic";
export type Band = "high" | "medium" | "low";

export const LIKELIHOOD_WEIGHT: Record<Likelihood, number> = {
  rare: 1,
  unlikely: 2,
  possible: 3,
  likely: 4,
  almost_certain: 5,
};

export const IMPACT_WEIGHT: Record<Impact, number> = {
  negligible: 1,
  minor: 2,
  moderate: 3,
  major: 4,
  catastrophic: 5,
};

/** 5x5 matrix → score in [1, 25]. Mirrors audit-service computeRiskScore. */
export function riskScore(likelihood: Likelihood, impact: Impact): number {
  return LIKELIHOOD_WEIGHT[likelihood] * IMPACT_WEIGHT[impact];
}

/** Display band thresholds shared by the page tiles, table pill and filter. */
export const BAND_HIGH_MIN = 15;
export const BAND_MEDIUM_MIN = 6;

export function band(score: number): Band {
  if (score >= BAND_HIGH_MIN) return "high";
  if (score >= BAND_MEDIUM_MIN) return "medium";
  return "low";
}

export const BAND_LABEL: Record<Band, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Human labels for the Add-Risk dialog option text (values stay the enums). */
export const LIKELIHOOD_LABEL: Record<Likelihood, string> = {
  rare: "Rare",
  unlikely: "Unlikely",
  possible: "Possible",
  likely: "Likely",
  almost_certain: "Almost certain",
};

export const IMPACT_LABEL: Record<Impact, string> = {
  negligible: "Negligible",
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
  catastrophic: "Catastrophic",
};

export const CATEGORY_LABEL: Record<string, string> = {
  financial: "Financial",
  operational: "Operational",
  compliance: "Compliance",
  reputational: "Reputational",
  strategic: "Strategic",
  it: "IT",
};

// GAP-AUDIT-RISK-REGISTER-03: map each status one-to-one. Unknown statuses
// render as a neutral pill with their raw text instead of being silently
// absorbed into "Monitored".
export type StatusTone = "info" | "warn" | "good" | "bad" | "mut";

export function statusLabel(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case "open":
      return { label: "Open", tone: "info" };
    case "mitigated":
      return { label: "Mitigated", tone: "warn" };
    case "closed":
      return { label: "Controlled", tone: "good" };
    case "escalated":
      return { label: "Escalated", tone: "bad" };
    default:
      return { label: status, tone: "mut" };
  }
}
