/**
 * triggers/domain.ts — PURE evaluation of generic trigger rules. No IO, no clock,
 * no randomness: `asOf` is always a parameter so an evaluation is reproducible
 * from its inputs months later.
 *
 * The half-open effective-window semantics are imported from matrix/domain rather
 * than restated, so effective dating means exactly one thing service-wide.
 */
import { isEffectiveAt, MAX_WEIGHT_BPS, type EffectiveWindow } from "../matrix/domain.js";
import { TRIGGER_RULE_TYPES, type TriggerConditions, type TriggerRuleType } from "./schema.js";

export { MAX_WEIGHT_BPS };

const MS_PER_DAY = 86_400_000;

/** Longest accepted category/event code — matches varchar(64) in the schema. */
export const MAX_CODE_LENGTH = 64;

export function isTriggerRuleType(value: string): value is TriggerRuleType {
  return (TRIGGER_RULE_TYPES as readonly string[]).includes(value);
}

/**
 * Normalise a tenant-authored code so "Savings", " savings " and "SAVINGS" are the
 * same category. Codes are opaque to the platform, so the only thing we may assume
 * is that operators do not intend case or padding to be significant.
 */
export function normaliseCode(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.trim().toLowerCase();
}

/**
 * Parse a minor-units money string into a bigint.
 *
 * Money never becomes a JS number here. Returns null for absent or malformed
 * input so a caller can distinguish "no value supplied" from "zero".
 */
export function parseMinorUnits(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/** Sum minor-unit strings in bigint. Absent/malformed entries contribute nothing. */
export function sumMinorUnits(values: readonly (string | null | undefined)[]): bigint {
  let total = 0n;
  for (const value of values) {
    const parsed = parseMinorUnits(value);
    if (parsed !== null) total += parsed;
  }
  return total;
}

// ── observations ──────────────────────────────────────────────────────────────

/** Something the subject already holds. `category` is the tenant's own code. */
export interface HoldingObservation {
  productId: string;
  category: string;
  /** Held value in minor units, as a STRING. */
  valueMinor?: string | undefined;
}

/**
 * A life event. `occurredAt` may be in the FUTURE — that is how a
 * maturity-approaching trigger is expressed, as a scheduled event.
 */
export interface LifeEventObservation {
  eventCode: string;
  occurredAt: string | Date;
  /** Subject age in whole years at `asOf`. Only needed by age-threshold rules. */
  ageYears?: number | undefined;
}

/**
 * Aggregated shipping-lane / volume behaviour over one observation window.
 * `laneCode` is an opaque tenant-defined lane identifier.
 */
export interface LanePatternObservation {
  laneCode: string;
  consignmentCount: number;
  /** Aggregate consignment value over the window, minor units as a STRING. */
  valueMinor?: string | undefined;
  /** Width of the observation window in days. */
  windowDays: number;
}

export interface SubjectObservation {
  holdings?: readonly HoldingObservation[] | undefined;
  lifeEvents?: readonly LifeEventObservation[] | undefined;
  lanePatterns?: readonly LanePatternObservation[] | undefined;
}

// ── rules ─────────────────────────────────────────────────────────────────────

/** The evaluable projection of a stored trigger rule row. */
export interface EvaluableRule extends EffectiveWindow {
  id: string;
  ruleType: TriggerRuleType;
  name: string;
  sourceCategory?: string | null | undefined;
  targetCategory: string;
  eventCode?: string | null | undefined;
  conditions: TriggerConditions;
  priority: number;
  weightBps: number;
  active: boolean;
}

export interface RaisedTrigger {
  ruleId: string;
  ruleType: TriggerRuleType;
  ruleName: string;
  targetCategory: string;
  priority: number;
  weightBps: number;
  /** Why it fired. Codes and counts only — never anything subject-identifying. */
  reason: string;
  /** Machine-readable support for the reason. Money stays a string. */
  evidence: Record<string, string | number>;
}

export interface EvaluateInput {
  rules: readonly EvaluableRule[];
  observation: SubjectObservation;
  asOf: Date;
  /** Restrict evaluation to these rule types. Absent/empty = all types. */
  ruleTypes?: readonly TriggerRuleType[] | undefined;
  /**
   * Suppress a trigger when the subject already holds the target category.
   * Default true: offering someone a category they already hold is the most
   * visible cross-sell failure there is.
   */
  suppressWhenTargetHeld?: boolean | undefined;
}

// ── per-type evaluation ───────────────────────────────────────────────────────

interface Fired {
  reason: string;
  evidence: Record<string, string | number>;
}

/**
 * holding_based: the subject holds enough of `sourceCategory` to justify offering
 * `targetCategory`. A rule with no sourceCategory cannot fire — without it the
 * rule has no subject to test, and firing on everything would be worse than
 * firing on nothing.
 */
function evaluateHoldingBased(
  rule: EvaluableRule,
  observation: SubjectObservation,
): Fired | null {
  const source = normaliseCode(rule.sourceCategory);
  if (source === "") return null;

  const holdings = observation.holdings ?? [];
  const matching = holdings.filter((h) => normaliseCode(h.category) === source);
  if (matching.length === 0) return null;

  const c = rule.conditions;

  if (c.minHoldingCount !== undefined && matching.length < c.minHoldingCount) return null;

  const evidence: Record<string, string | number> = {
    sourceCategory: source,
    holdingCount: matching.length,
  };

  if (c.minHoldingValueMinor !== undefined) {
    const threshold = parseMinorUnits(c.minHoldingValueMinor);
    // A malformed threshold fails closed: a typo in configuration must not turn
    // a value-gated rule into an ungated one.
    if (threshold === null) return null;
    const total = sumMinorUnits(matching.map((h) => h.valueMinor));
    if (total < threshold) return null;
    evidence.holdingValueMinor = total.toString();
  }

  return {
    reason: `holds ${matching.length} in category ${source}`,
    evidence,
  };
}

/**
 * life_event: an event of the rule's code happened, or is scheduled to happen,
 * close enough to `asOf`.
 *
 * `withinDays` is compared on the ABSOLUTE distance, which is what lets one
 * mechanism express both "maturity is approaching" (future event) and "the
 * address changed recently" (past event) without a second rule type.
 */
function evaluateLifeEvent(
  rule: EvaluableRule,
  observation: SubjectObservation,
  asOf: Date,
): Fired | null {
  const code = normaliseCode(rule.eventCode);
  if (code === "") return null;

  const events = observation.lifeEvents ?? [];
  const c = rule.conditions;

  for (const event of events) {
    if (normaliseCode(event.eventCode) !== code) continue;

    const occurredMs =
      event.occurredAt instanceof Date ? event.occurredAt.getTime() : new Date(event.occurredAt).getTime();
    if (!Number.isFinite(occurredMs)) continue;

    const deltaDays = Math.abs(occurredMs - asOf.getTime()) / MS_PER_DAY;

    if (c.withinDays !== undefined) {
      if (!Number.isFinite(c.withinDays) || c.withinDays < 0) continue;
      // Inclusive: an event exactly `withinDays` away still fires.
      if (deltaDays > c.withinDays) continue;
    }

    if (c.minAgeYears !== undefined || c.maxAgeYears !== undefined) {
      // Fail closed when the age gate exists but the age is unknown.
      if (event.ageYears === undefined || !Number.isFinite(event.ageYears)) continue;
      if (c.minAgeYears !== undefined && event.ageYears < c.minAgeYears) continue;
      if (c.maxAgeYears !== undefined && event.ageYears > c.maxAgeYears) continue;
    }

    const evidence: Record<string, string | number> = {
      eventCode: code,
      daysFromAsOf: Math.round(deltaDays * 100) / 100,
      direction: occurredMs >= asOf.getTime() ? "upcoming" : "past",
    };
    if (event.ageYears !== undefined && Number.isFinite(event.ageYears)) {
      evidence.ageYears = event.ageYears;
    }

    return { reason: `life event ${code} within ${evidence.daysFromAsOf} days`, evidence };
  }

  return null;
}

/**
 * volume_pattern: aggregate lane behaviour crossed the configured thresholds.
 *
 * Thresholds are compared against the AGGREGATE across the supplied observations,
 * not per lane: the signal a premium-tier offer keys off is total throughput and
 * lane spread, and a per-lane test would never fire for a customer whose volume is
 * spread thinly over many lanes — which is exactly the customer worth the offer.
 *
 * `minWindowDays` guards against a threshold being met by a freak single day: it
 * requires the observation to actually span a meaningful period. The widest
 * supplied window is used, since the aggregate covers all of them.
 */
function evaluateVolumePattern(
  rule: EvaluableRule,
  observation: SubjectObservation,
): Fired | null {
  const patterns = observation.lanePatterns ?? [];
  if (patterns.length === 0) return null;

  const c = rule.conditions;

  let totalConsignments = 0;
  let widestWindowDays = 0;
  const lanes = new Set<string>();

  for (const pattern of patterns) {
    if (Number.isFinite(pattern.consignmentCount) && pattern.consignmentCount > 0) {
      totalConsignments += pattern.consignmentCount;
    }
    if (Number.isFinite(pattern.windowDays) && pattern.windowDays > widestWindowDays) {
      widestWindowDays = pattern.windowDays;
    }
    const lane = normaliseCode(pattern.laneCode);
    if (lane !== "") lanes.add(lane);
  }

  if (c.minVolume !== undefined && totalConsignments < c.minVolume) return null;
  if (c.minDistinctLanes !== undefined && lanes.size < c.minDistinctLanes) return null;
  if (c.minWindowDays !== undefined && widestWindowDays < c.minWindowDays) return null;

  const evidence: Record<string, string | number> = {
    consignmentCount: totalConsignments,
    distinctLanes: lanes.size,
    windowDays: widestWindowDays,
  };

  if (c.minValueMinor !== undefined) {
    const threshold = parseMinorUnits(c.minValueMinor);
    if (threshold === null) return null;
    const total = sumMinorUnits(patterns.map((p) => p.valueMinor));
    if (total < threshold) return null;
    evidence.valueMinor = total.toString();
  }

  return {
    reason: `${totalConsignments} consignments across ${lanes.size} lanes in ${widestWindowDays}d`,
    evidence,
  };
}

// ── evaluation entrypoint ─────────────────────────────────────────────────────

/**
 * Evaluate every supplied rule against one subject observation.
 *
 * A rule is skipped when it is inactive, outside its effective window, or of a
 * type the caller did not ask for. Ordering of the result is total and therefore
 * reproducible: priority DESC, weightBps DESC, ruleId ASC.
 *
 * PURE.
 */
export function evaluateTriggers(input: EvaluateInput): RaisedTrigger[] {
  const wanted =
    input.ruleTypes === undefined || input.ruleTypes.length === 0
      ? null
      : new Set<TriggerRuleType>(input.ruleTypes);

  const suppressWhenTargetHeld = input.suppressWhenTargetHeld !== false;
  const heldCategories = new Set(
    (input.observation.holdings ?? []).map((h) => normaliseCode(h.category)).filter((c) => c !== ""),
  );

  const raised: RaisedTrigger[] = [];

  for (const rule of input.rules) {
    if (!rule.active) continue;
    if (wanted !== null && !wanted.has(rule.ruleType)) continue;
    if (!isEffectiveAt(rule, input.asOf)) continue;

    const target = normaliseCode(rule.targetCategory);
    if (target === "") continue;
    if (suppressWhenTargetHeld && heldCategories.has(target)) continue;

    let fired: Fired | null;
    switch (rule.ruleType) {
      case "holding_based":
        fired = evaluateHoldingBased(rule, input.observation);
        break;
      case "life_event":
        fired = evaluateLifeEvent(rule, input.observation, input.asOf);
        break;
      case "volume_pattern":
        fired = evaluateVolumePattern(rule, input.observation);
        break;
    }

    if (fired === null) continue;

    raised.push({
      ruleId: rule.id,
      ruleType: rule.ruleType,
      ruleName: rule.name,
      targetCategory: rule.targetCategory,
      priority: rule.priority,
      weightBps: rule.weightBps,
      reason: fired.reason,
      evidence: fired.evidence,
    });
  }

  return raised.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.weightBps !== a.weightBps) return b.weightBps - a.weightBps;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });
}

// ── configuration validation ──────────────────────────────────────────────────

/** Validate the condition bag for a rule type. Returns null when valid. */
export function validateConditions(
  ruleType: TriggerRuleType,
  conditions: TriggerConditions,
): string | null {
  const nonNegativeInts: (keyof TriggerConditions)[] = [
    "minHoldingCount",
    "withinDays",
    "minAgeYears",
    "maxAgeYears",
    "minVolume",
    "minDistinctLanes",
    "minWindowDays",
  ];

  for (const key of nonNegativeInts) {
    const value = conditions[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return `${key} must be a non-negative integer`;
    }
  }

  for (const key of ["minHoldingValueMinor", "minValueMinor"] as const) {
    const value = conditions[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || parseMinorUnits(value) === null) {
      return `${key} must be an integer minor-unit string`;
    }
  }

  if (
    conditions.minAgeYears !== undefined &&
    conditions.maxAgeYears !== undefined &&
    conditions.maxAgeYears < conditions.minAgeYears
  ) {
    return "maxAgeYears must be greater than or equal to minAgeYears";
  }

  if (ruleType === "holding_based") {
    if (conditions.withinDays !== undefined || conditions.minVolume !== undefined) {
      return "holding_based rules accept only minHoldingCount and minHoldingValueMinor";
    }
  }

  if (ruleType === "volume_pattern") {
    if (conditions.minHoldingCount !== undefined || conditions.withinDays !== undefined) {
      return "volume_pattern rules accept only volume, lane, window and value thresholds";
    }
  }

  return null;
}

/** Validate the structural shape of a rule. Returns null when valid. */
export function validateRuleShape(rule: {
  ruleType: TriggerRuleType;
  sourceCategory?: string | null | undefined;
  targetCategory: string;
  eventCode?: string | null | undefined;
}): string | null {
  if (normaliseCode(rule.targetCategory) === "") return "targetCategory is required";

  if (rule.ruleType === "holding_based") {
    if (normaliseCode(rule.sourceCategory) === "") {
      return "holding_based rules require a sourceCategory";
    }
    if (normaliseCode(rule.sourceCategory) === normaliseCode(rule.targetCategory)) {
      return "sourceCategory and targetCategory must differ";
    }
  }

  if (rule.ruleType === "life_event" && normaliseCode(rule.eventCode) === "") {
    return "life_event rules require an eventCode";
  }

  return null;
}

/**
 * Convert raised triggers into candidates for the EXISTING nba ranking engine.
 *
 * Weight in basis points becomes the 0..1 `affinity` signal, and priority is
 * carried through as the ranking tie-break. Reusing rankActions() here is
 * deliberate: a trigger-raised recommendation and a matrix-raised one must be
 * comparable on one scale, which they cannot be if triggers get their own scorer.
 */
export function triggersToCandidates(raised: readonly RaisedTrigger[]): {
  id: string;
  actionType: string;
  productId: null;
  priority: number;
  signals: { affinity: number; value: number };
}[] {
  return raised.map((trigger) => {
    const affinity = Math.min(1, Math.max(0, trigger.weightBps / MAX_WEIGHT_BPS));
    return {
      id: trigger.ruleId,
      actionType: `trigger:${trigger.ruleType}`,
      productId: null,
      priority: trigger.priority,
      signals: { affinity, value: affinity },
    };
  });
}
