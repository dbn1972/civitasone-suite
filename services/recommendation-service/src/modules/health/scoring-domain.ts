/**
 * health/scoring-domain.ts — KA-004 banded account health scoring. PURE.
 *
 * Added alongside domain.ts (which owns the legacy 4-band RFM classification
 * used by the existing endpoints) because KA-004 defines a different, explicit
 * band set that the key-account dashboard depends on:
 *
 *    0–25  critical
 *   26–50  at_risk
 *   51–75  healthy
 *  76–100  thriving
 *
 * Out-of-range and non-numeric signals are CLAMPED rather than rejected. A
 * health score is a dashboard aggregate assembled from several upstream systems;
 * throwing would take the whole account view down because one feed reported
 * 105% engagement. Clamping degrades gracefully and is visible in the returned
 * contributing factors.
 */

export type HealthBand = "critical" | "at_risk" | "healthy" | "thriving";

export const HEALTH_BANDS: readonly HealthBand[] = ["critical", "at_risk", "healthy", "thriving"];

/** Inclusive upper bound of each band. */
export const BAND_UPPER_BOUNDS = {
  critical: 25,
  at_risk: 50,
  healthy: 75,
  thriving: 100,
} as const;

/** Bands that put an account on the at-risk watchlist. */
export const AT_RISK_BANDS: readonly HealthBand[] = ["critical", "at_risk"];

export type HealthSignalName =
  | "productUsage"
  | "engagement"
  | "supportBurden"
  | "paymentTimeliness"
  | "relationshipDepth";

/** Weights sum to 1 so the composite is always inside 0..100. */
export const SIGNAL_WEIGHTS: Record<HealthSignalName, number> = {
  productUsage: 0.3,
  engagement: 0.2,
  /** Already inverted by the caller: 100 = no support burden. */
  supportBurden: 0.15,
  paymentTimeliness: 0.2,
  relationshipDepth: 0.15,
};

export const HEALTH_SIGNAL_NAMES: readonly HealthSignalName[] = [
  "productUsage",
  "engagement",
  "supportBurden",
  "paymentTimeliness",
  "relationshipDepth",
];

/**
 * Type alias (not an interface) so it keeps an implicit index signature and can
 * be written straight into the `factors` jsonb column.
 */
export type HealthSignals = {
  [K in HealthSignalName]?: number | undefined;
};

export interface ContributingFactor {
  signal: HealthSignalName;
  /** The value actually used — post-clamp. */
  value: number;
  weight: number;
  /** value * weight, rounded to 2 dp. */
  contribution: number;
  /** True when the supplied value was outside 0..100 (or not a number) and was clamped. */
  clamped: boolean;
}

export interface HealthBreakdown {
  /** Integer 0..100. */
  score: number;
  band: HealthBand;
  contributingFactors: ContributingFactor[];
}

/** Clamp to 0..100; a missing or non-finite signal contributes nothing. */
function clampSignal(raw: number | undefined): { value: number; clamped: boolean } {
  if (raw === undefined) return { value: 0, clamped: false };
  if (typeof raw !== "number" || !Number.isFinite(raw)) return { value: 0, clamped: true };
  if (raw < 0) return { value: 0, clamped: true };
  if (raw > 100) return { value: 100, clamped: true };
  return { value: raw, clamped: false };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Map an integer 0..100 score onto a KA-004 band. Out-of-range scores are
 * clamped, so bandOf(-10) is critical and bandOf(120) is thriving.
 */
export function bandOf(score: number): HealthBand {
  // NaN carries no information, so it bands as critical rather than clamping to
  // a boundary. ±Infinity does carry direction and is clamped to 0 / 100.
  if (Number.isNaN(score)) return "critical";
  const value = Math.min(100, Math.max(0, score));
  if (value <= BAND_UPPER_BOUNDS.critical) return "critical";
  if (value <= BAND_UPPER_BOUNDS.at_risk) return "at_risk";
  if (value <= BAND_UPPER_BOUNDS.healthy) return "healthy";
  return "thriving";
}

export function isAtRiskBand(band: string): boolean {
  return (AT_RISK_BANDS as readonly string[]).includes(band);
}

/**
 * Weighted 0..100 health score plus its band and per-signal breakdown.
 *
 * Contributing factors are sorted by contribution descending with a stable
 * tie-break on signal name, so the "top reason" shown in the UI never flips
 * between two equal factors.
 */
export function computeHealthScore(signals: HealthSignals): HealthBreakdown {
  const contributingFactors: ContributingFactor[] = HEALTH_SIGNAL_NAMES.map((signal) => {
    const { value, clamped } = clampSignal(signals?.[signal]);
    const weight = SIGNAL_WEIGHTS[signal];
    return { signal, value, weight, contribution: round2(value * weight), clamped };
  });

  const total = contributingFactors.reduce((sum, f) => sum + f.value * f.weight, 0);
  const score = Math.round(Math.min(100, Math.max(0, total)));

  contributingFactors.sort((a, b) => {
    if (b.contribution !== a.contribution) return b.contribution - a.contribution;
    return a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : 0;
  });

  return { score, band: bandOf(score), contributingFactors };
}
