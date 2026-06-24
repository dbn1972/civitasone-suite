// P1-7: server-computed risk scoring (likelihood x impact) for the audit risk register.
// Inputs (likelihood / impact) are the only trusted client values; risk_score is ALWAYS
// computed server-side from these ordinal weights, never taken from the request body.

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type Likelihood = "rare" | "unlikely" | "possible" | "likely" | "almost_certain";
export type Impact = "negligible" | "minor" | "moderate" | "major" | "catastrophic";

const LIKELIHOOD_WEIGHT: Record<Likelihood, number> = {
  rare: 1,
  unlikely: 2,
  possible: 3,
  likely: 4,
  almost_certain: 5,
};

const IMPACT_WEIGHT: Record<Impact, number> = {
  negligible: 1,
  minor: 2,
  moderate: 3,
  major: 4,
  catastrophic: 5,
};

/** 5x5 matrix → score in [1, 25]. */
export function computeRiskScore(likelihood: Likelihood, impact: Impact): number {
  const l = LIKELIHOOD_WEIGHT[likelihood];
  const i = IMPACT_WEIGHT[impact];
  if (!l || !i) {
    throw new DomainError("INVALID_RISK_INPUT", `unknown likelihood/impact: ${likelihood}/${impact}`);
  }
  return l * i;
}

/** Banding used by the audit-universe selector and the read-model. */
export function riskBand(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 15) return "critical";
  if (score >= 9) return "high";
  if (score >= 4) return "medium";
  return "low";
}

/** A risk is "high" (audit-universe candidate) when score >= threshold (default 12 ≈ 3x4). */
export const HIGH_RISK_THRESHOLD = 12;
