/**
 * G6 — Segment eligibility domain logic (pure functions).
 *
 * These functions implement the decision logic for:
 * 1. Whether a product is eligible for cross-sell within a segment
 * 2. Which channels to route a recommendation through
 * 3. Filtering a set of recommendations to only eligible ones
 *
 * No side effects — DB/cache/queue interactions live in repo.ts and consumer.ts.
 */

export interface EligibilityRule {
  segmentCode: string;
  productId: string;
  eligible: boolean;
  channelOverride: string[] | null;
}

export interface SegmentDefinition {
  segmentCode: string;
  priorityProducts: string[];
  primaryChannels: string[];
}

export interface Recommendation {
  id: string;
  productId: string;
  [key: string]: unknown;
}

/**
 * Determines whether a product is eligible for cross-sell within a segment.
 *
 * Logic:
 * - If a rule exists for this segment×product: return rule.eligible
 * - If no rule exists: default to true (permissive — all products are eligible
 *   unless explicitly blocked)
 */
export function isProductEligible(
  segmentCode: string,
  productId: string,
  rules: EligibilityRule[],
): boolean {
  const rule = rules.find(
    (r) => r.segmentCode === segmentCode && r.productId === productId,
  );
  if (!rule) return true;
  return rule.eligible;
}

/**
 * Resolves the delivery channels for a product×segment combination.
 *
 * Priority:
 * 1. If a rule has a channel_override for this segment×product → use it
 * 2. Fall back to the segment definition's primaryChannels
 * 3. If both are empty → return empty array (callers should treat as "all channels")
 */
export function resolveChannels(
  segmentCode: string,
  productId: string,
  rules: EligibilityRule[],
  segmentDefinition: SegmentDefinition | null,
): string[] {
  const rule = rules.find(
    (r) => r.segmentCode === segmentCode && r.productId === productId,
  );
  if (rule?.channelOverride && rule.channelOverride.length > 0) {
    return rule.channelOverride;
  }
  return segmentDefinition?.primaryChannels ?? [];
}

/**
 * Filters a list of recommendations, removing products that are ineligible
 * for the contact's segment.
 *
 * Used by the recommendation-service trigger pipeline to prune cross-sell
 * candidates before delivery.
 */
export function filterRecommendations(
  recommendations: Recommendation[],
  contactSegmentCode: string,
  rules: EligibilityRule[],
): Recommendation[] {
  return recommendations.filter((rec) =>
    isProductEligible(contactSegmentCode, rec.productId, rules),
  );
}
