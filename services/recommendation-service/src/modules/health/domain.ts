/**
 * health/domain.ts — Pure account health scoring.
 *
 * Health is an RFM-style composite: recency, frequency and monetary value of
 * the relationship, adjusted by support load and engagement. Each factor is
 * supplied already normalised to 0..100 by the caller so this module stays
 * free of data access and of tenant-specific thresholds.
 */

/**
 * Declared as a type alias (not an interface) so it keeps an implicit index
 * signature and can be persisted directly into the `factors` jsonb column.
 */
export type HealthFactors = {
  /** How recently the account transacted (100 = today). */
  recency?: number | undefined;
  /** How often the account transacts (100 = most frequent cohort). */
  frequency?: number | undefined;
  /** Relative revenue contribution (100 = top cohort). */
  monetary?: number | undefined;
  /** Support-load health (100 = no open/escalated tickets). */
  supportTickets?: number | undefined;
  /** Product/portal engagement (100 = highly engaged). */
  engagement?: number | undefined;
};

/** Relative weights — sum to 1 so the composite stays inside 0..100. */
export const HEALTH_WEIGHTS = {
  recency: 0.25,
  frequency: 0.2,
  monetary: 0.25,
  supportTickets: 0.15,
  engagement: 0.15,
} as const;

export type HealthFactorName = keyof typeof HEALTH_WEIGHTS;

export const HEALTH_FACTOR_NAMES: readonly HealthFactorName[] = [
  "recency",
  "frequency",
  "monetary",
  "supportTickets",
  "engagement",
];

export type HealthClassification = "critical" | "at_risk" | "healthy" | "excellent";

/** Lower bound (inclusive) of each band. */
export const HEALTH_BANDS = {
  atRisk: 40,
  healthy: 60,
  excellent: 80,
} as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Weighted 0..100 health score. Missing factors contribute zero, which is
 * deliberate: an account with no engagement signal is not a healthy account.
 */
export function computeHealthScore(factors: HealthFactors): number {
  let total = 0;
  for (const name of HEALTH_FACTOR_NAMES) {
    const raw = factors[name];
    const value = raw === undefined ? 0 : clamp(raw, 0, 100);
    total += value * HEALTH_WEIGHTS[name];
  }
  return Math.round(clamp(total, 0, 100));
}

/** Map a 0..100 score onto a relationship-health band. */
export function classifyHealth(score: number): HealthClassification {
  const value = clamp(score, 0, 100);
  if (value >= HEALTH_BANDS.excellent) return "excellent";
  if (value >= HEALTH_BANDS.healthy) return "healthy";
  if (value >= HEALTH_BANDS.atRisk) return "at_risk";
  return "critical";
}

/**
 * Validate a factor bundle. Returns null when valid, otherwise a human message
 * suitable for a 422 response.
 */
export function validateFactors(factors: HealthFactors): string | null {
  if (factors === null || typeof factors !== "object") return "factors must be an object";

  const entries = Object.entries(factors as Record<string, unknown>);
  const known = new Set<string>(HEALTH_FACTOR_NAMES);

  for (const [key, value] of entries) {
    if (!known.has(key)) return `unknown factor: ${key}`;
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${key} must be a finite number`;
    }
    if (value < 0 || value > 100) {
      return `${key} must be between 0 and 100`;
    }
  }

  const provided = entries.filter(([, value]) => value !== undefined);
  if (provided.length === 0) return "at least one factor is required";

  return null;
}
