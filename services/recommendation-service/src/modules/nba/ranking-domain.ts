/**
 * nba/ranking-domain.ts — F.6 next-best-action ranking. PURE: no IO, no clock,
 * no randomness.
 *
 * Determinism is a hard requirement, not a nicety. A rep who refreshes the
 * screen must see the same order, and an auditor must be able to reproduce a
 * ranking from the stored candidate set months later. Two consequences:
 *
 *   1. Scores are rounded to 4 dp before comparison, so tiny float differences
 *      in the weighted sum cannot reorder otherwise-equal actions.
 *   2. Ties are broken by an explicit, total ordering — priority DESC, then
 *      id ASC. `id` is unique per candidate, so the comparator never returns 0
 *      for two distinct candidates and the result does not depend on the
 *      engine's sort stability or on the input order.
 */

export type ActionSignalName = "affinity" | "propensity" | "value" | "urgency";

export const ACTION_SIGNAL_NAMES: readonly ActionSignalName[] = [
  "affinity",
  "propensity",
  "value",
  "urgency",
];

/** Every signal is a 0..1 ratio supplied by the caller (already normalised). */
export type ActionSignals = {
  /** Product/segment affinity for this profile. */
  affinity?: number | undefined;
  /** Modelled propensity to act (from predictive_scores). */
  propensity?: number | undefined;
  /** Relative commercial value of the action. */
  value?: number | undefined;
  /** Time pressure — renewal window closing, offer expiring. */
  urgency?: number | undefined;
};

export type RankingWeights = Record<ActionSignalName, number>;

/**
 * Caller-supplied weight overrides. Spelled out with `| undefined` rather than
 * `Partial<RankingWeights>` so it accepts objects built under
 * exactOptionalPropertyTypes (where an absent key is present-and-undefined).
 */
export type WeightOverrides = { [K in ActionSignalName]?: number | undefined };

/**
 * Default weighting. Propensity leads because an action nobody will take has no
 * value regardless of how much it is worth on paper.
 */
export const DEFAULT_WEIGHTS: RankingWeights = {
  affinity: 0.25,
  propensity: 0.35,
  value: 0.25,
  urgency: 0.15,
};

/** Eligibility rules attached to a candidate action. */
export interface ActionEligibility {
  /** Action may only be served on these channels. Empty/absent = any channel. */
  channels?: readonly string[] | undefined;
  /** Action only applies to these customer segments. Empty/absent = any segment. */
  segments?: readonly string[] | undefined;
  /** Action requires marketing/contact consent. */
  requiresConsent?: boolean | undefined;
  /** Minimum account health score (0..100) required to offer this action. */
  minHealthScore?: number | undefined;
  /** Action is suppressed entirely (kill switch from the campaign owner). */
  suppressed?: boolean | undefined;
}

export interface ActionCandidate {
  /** Unique within a candidate set — used as the final, total tie-break. */
  id: string;
  actionType: string;
  productId?: string | null | undefined;
  /** Business priority from the cross-sell matrix. Higher wins ties. */
  priority?: number | undefined;
  signals: ActionSignals;
  eligibility?: ActionEligibility | undefined;
}

export interface EligibilityContext {
  channel?: string | undefined;
  segment?: string | undefined;
  /**
   * Marketing-consent verdict RESOLVED BY THE SERVER (P2-1). It must come from
   * the CRM system of record via consent-resolution.ts and never from the
   * request body, or a caller could assert its own consent and collect
   * consent-gated actions. Named `consentGranted`, not `hasConsent`, so the old
   * body-supplied field cannot flow back in unnoticed.
   */
  consentGranted?: boolean | undefined;
  healthScore?: number | undefined;
}

export interface RankedAction {
  id: string;
  actionType: string;
  productId: string | null;
  priority: number;
  /** Weighted score in 0..1, rounded to 4 dp. */
  score: number;
  /** Per-signal contributions, for explainability. */
  contributions: { signal: ActionSignalName; value: number; weight: number; contribution: number }[];
  /** Human-readable justification shown next to the action. */
  reason: string;
}

function clamp01(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Round to 4 dp — the comparison scale, see the determinism note above. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Normalise weights so they sum to 1. A caller may pass raw importances (3, 1,
 * 1, 1) rather than fractions; without this the score would leave 0..1. A
 * non-positive total falls back to the defaults rather than dividing by zero.
 */
export function normaliseWeights(weights: WeightOverrides | undefined): RankingWeights {
  const raw: RankingWeights = {
    affinity: Math.max(0, Number(weights?.affinity ?? DEFAULT_WEIGHTS.affinity) || 0),
    propensity: Math.max(0, Number(weights?.propensity ?? DEFAULT_WEIGHTS.propensity) || 0),
    value: Math.max(0, Number(weights?.value ?? DEFAULT_WEIGHTS.value) || 0),
    urgency: Math.max(0, Number(weights?.urgency ?? DEFAULT_WEIGHTS.urgency) || 0),
  };

  const total = ACTION_SIGNAL_NAMES.reduce((sum, name) => sum + raw[name], 0);
  if (!Number.isFinite(total) || total <= 0) return { ...DEFAULT_WEIGHTS };

  return {
    affinity: raw.affinity / total,
    propensity: raw.propensity / total,
    value: raw.value / total,
    urgency: raw.urgency / total,
  };
}

/** Build the explainability breakdown for one candidate. */
function contributionsOf(
  candidate: ActionCandidate,
  weights: RankingWeights,
): RankedAction["contributions"] {
  return ACTION_SIGNAL_NAMES.map((signal) => {
    const value = clamp01(candidate.signals?.[signal]);
    const weight = weights[signal];
    return { signal, value, weight: round4(weight), contribution: round4(value * weight) };
  });
}

/**
 * Reason string derived from the largest contributor. Deterministic: ties on
 * contribution fall back to the declared signal order (affinity → propensity →
 * value → urgency) because ACTION_SIGNAL_NAMES is iterated in that order and a
 * later signal only wins on a strictly greater contribution.
 */
export function explainAction(
  candidate: ActionCandidate,
  contributions: RankedAction["contributions"],
): string {
  let best = contributions[0];
  for (const entry of contributions) {
    if (best === undefined || entry.contribution > best.contribution) best = entry;
  }

  if (best === undefined || best.contribution === 0) {
    return `${candidate.actionType}: no positive signal, ranked on priority ${candidate.priority ?? 0}`;
  }
  return `${candidate.actionType}: driven by ${best.signal} (${best.value.toFixed(2)})`;
}

/** Weighted score for one candidate, rounded to the comparison scale. */
export function scoreAction(candidate: ActionCandidate, weights: RankingWeights): number {
  let total = 0;
  for (const signal of ACTION_SIGNAL_NAMES) {
    total += clamp01(candidate.signals?.[signal]) * weights[signal];
  }
  return round4(Math.min(1, Math.max(0, total)));
}

/**
 * Rank candidates highest-score-first.
 *
 * Tie-break order (documented and STABLE):
 *   1. score DESC (rounded to 4 dp)
 *   2. priority DESC
 *   3. id ASC — unique, so the ordering is total and input-order independent
 *
 * The input array is never mutated.
 */
export function rankActions(
  candidates: readonly ActionCandidate[],
  weights?: WeightOverrides,
): RankedAction[] {
  const w = normaliseWeights(weights);

  const scored: RankedAction[] = candidates.map((candidate) => {
    const contributions = contributionsOf(candidate, w);
    return {
      id: candidate.id,
      actionType: candidate.actionType,
      productId: candidate.productId ?? null,
      priority: Number.isFinite(candidate.priority) ? (candidate.priority as number) : 0,
      score: scoreAction(candidate, w),
      contributions,
      reason: explainAction(candidate, contributions),
    };
  });

  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Drop candidates the context makes ineligible. Order is preserved so the
 * caller can rank before or after filtering with the same result.
 *
 * A rule that is absent on the candidate is treated as "no restriction"; a rule
 * that is present but cannot be evaluated (no channel in the context) is treated
 * as NOT satisfied. Failing closed is the right default for consent and for
 * channel targeting — serving an offer on the wrong channel is a compliance
 * problem, not a UX one.
 */
export function applyEligibility(
  candidates: readonly ActionCandidate[],
  context: EligibilityContext,
): ActionCandidate[] {
  return candidates.filter((candidate) => {
    const rules = candidate.eligibility;
    if (rules === undefined) return true;

    if (rules.suppressed === true) return false;

    if (rules.requiresConsent === true && context.consentGranted !== true) return false;

    if (rules.channels !== undefined && rules.channels.length > 0) {
      if (context.channel === undefined || !rules.channels.includes(context.channel)) return false;
    }

    if (rules.segments !== undefined && rules.segments.length > 0) {
      if (context.segment === undefined || !rules.segments.includes(context.segment)) return false;
    }

    if (rules.minHealthScore !== undefined && Number.isFinite(rules.minHealthScore)) {
      const health = context.healthScore;
      if (health === undefined || !Number.isFinite(health)) return false;
      if (health < rules.minHealthScore) return false;
    }

    return true;
  });
}
