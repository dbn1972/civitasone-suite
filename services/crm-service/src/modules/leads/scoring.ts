/**
 * Lead scoring domain logic.
 *
 * Pure function: computes a lead's numeric score (0–100) based on weighted
 * attribute scoring rules. Each rule evaluates one lead attribute and produces
 * a partial score; the final score is the weighted sum clamped to [0, 100].
 *
 * Validates: Requirements 8.5
 */

/**
 * A single scoring rule that evaluates one lead attribute.
 *
 * @property attribute — the key on the lead to evaluate
 * @property weight — importance weight (0–100); all weights in the rule set should sum to 100
 * @property scoreFn — evaluator returning a raw score (0–100) for the attribute value
 */
export interface ScoringRule {
  attribute: string;
  weight: number; // 0–100, weights sum to 100
  scoreFn: (value: unknown) => number; // returns 0–100
}

/**
 * Lead attributes record — a plain key-value map representing a lead's
 * scoreable attributes. The keys match ScoringRule.attribute.
 */
export type LeadAttributes = Record<string, unknown>;

/**
 * Computes a lead score from weighted attribute rules.
 *
 * Formula: sum(rule.weight * rule.scoreFn(lead[rule.attribute])) / 100
 * Result is clamped to the integer range [0, 100].
 *
 * Edge cases:
 * - Empty rules array → 0
 * - Missing attribute on lead → scoreFn receives undefined
 * - scoreFn results are individually clamped to [0, 100] before weighting
 * - Final weighted sum is rounded and clamped to [0, 100]
 *
 * @param lead — the lead's attribute map
 * @param rules — the tenant's scoring rule configuration
 * @returns integer score in [0, 100]
 */
export function computeLeadScore(lead: LeadAttributes, rules: ScoringRule[]): number {
  if (rules.length === 0) return 0;

  let weightedSum = 0;

  for (const rule of rules) {
    const rawScore = rule.scoreFn(lead[rule.attribute]);
    // Clamp individual scoreFn output to [0, 100]
    const clampedScore = Math.max(0, Math.min(100, rawScore));
    weightedSum += rule.weight * clampedScore;
  }

  // Divide by 100 (since weights sum to 100, this normalizes to 0–100 range)
  const finalScore = weightedSum / 100;

  // Round and clamp to integer [0, 100]
  return Math.max(0, Math.min(100, Math.round(finalScore)));
}
