/**
 * PC-004 — availability resolution (most-specific-wins). PURE, no I/O.
 *
 * A product's availability is expressed as a set of rows over a three-level
 * location hierarchy: circle > region > office. Each level on a row is either a
 * concrete code or NULL, where NULL means "any" (a wildcard).
 *
 * Resolution rule: among the rows that MATCH the queried location, the row with
 * the most concrete levels wins. Specificity is scored so that a more concrete
 * level can never be outvoted by a combination of broader ones:
 *
 *   office  = 4   (narrowest — a single branch override)
 *   region  = 2
 *   circle  = 1   (broadest)
 *
 * With these weights an office-specific row (4) always beats any row that leaves
 * office as a wildcard (max 1 + 2 = 3), and a region-specific row (2, or 3 with a
 * circle) always beats a circle-only row (1). Ties (identical specificity, e.g.
 * two rows for the same office) are broken deterministically: an explicit
 * `available: false` wins, because a deny is the safer resolution when the
 * catalogue contains contradictory rows.
 */

export interface AvailabilityRule {
  circleCode: string | null;
  regionCode: string | null;
  officeCode: string | null;
  available: boolean;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}

export interface LocationQuery {
  circleCode?: string | null;
  regionCode?: string | null;
  officeCode?: string | null;
}

const WEIGHT_OFFICE = 4;
const WEIGHT_REGION = 2;
const WEIGHT_CIRCLE = 1;

/**
 * Does this rule apply to the queried location?
 *
 * A NULL level on the rule matches anything. A concrete level on the rule must
 * equal the queried value; if the query does not supply that level at all the
 * rule is too specific to apply and is excluded.
 */
export function ruleMatchesLocation(rule: AvailabilityRule, query: LocationQuery): boolean {
  const levels: ReadonlyArray<[string | null, string | null | undefined]> = [
    [rule.circleCode, query.circleCode],
    [rule.regionCode, query.regionCode],
    [rule.officeCode, query.officeCode],
  ];
  for (const [ruleValue, queryValue] of levels) {
    if (ruleValue === null) continue; // wildcard — matches any query value
    if (queryValue === undefined || queryValue === null) return false;
    if (ruleValue !== queryValue) return false;
  }
  return true;
}

/** Specificity score. Higher = more concrete. A full wildcard row scores 0. */
export function specificityScore(rule: AvailabilityRule): number {
  return (
    (rule.officeCode !== null ? WEIGHT_OFFICE : 0) +
    (rule.regionCode !== null ? WEIGHT_REGION : 0) +
    (rule.circleCode !== null ? WEIGHT_CIRCLE : 0)
  );
}

/** Is the rule in force at `at`? Rows with no dates are always in force. */
export function ruleIsEffective(rule: AvailabilityRule, at: Date): boolean {
  if (rule.effectiveFrom instanceof Date && rule.effectiveFrom.getTime() > at.getTime()) return false;
  if (rule.effectiveTo instanceof Date && rule.effectiveTo.getTime() < at.getTime()) return false;
  return true;
}

export interface AvailabilityResolution {
  /** Resolved availability. `false` when no rule matches (deny by default). */
  available: boolean;
  /** The winning rule, or null when nothing matched. */
  matchedRule: AvailabilityRule | null;
  /** Specificity of the winning rule; null when nothing matched. */
  specificity: number | null;
  /** How many effective rules matched the location before tie-breaking. */
  candidateCount: number;
}

/**
 * Resolve whether a product is available at a location, most-specific-wins.
 *
 * Returns `available: false` with `matchedRule: null` when no rule matches —
 * a product with no availability row for a location is NOT available there.
 */
export function resolveAvailability(
  rules: readonly AvailabilityRule[],
  query: LocationQuery,
  at: Date = new Date(),
): AvailabilityResolution {
  const candidates = rules.filter((r) => ruleIsEffective(r, at) && ruleMatchesLocation(r, query));
  if (candidates.length === 0) {
    return { available: false, matchedRule: null, specificity: null, candidateCount: 0 };
  }

  let winner = candidates[0]!;
  let winnerScore = specificityScore(winner);
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i]!;
    const score = specificityScore(candidate);
    if (score > winnerScore) {
      winner = candidate;
      winnerScore = score;
    } else if (score === winnerScore && !candidate.available && winner.available) {
      // Deterministic tie-break: an explicit deny beats an allow at equal depth.
      winner = candidate;
    }
  }

  return {
    available: winner.available,
    matchedRule: winner,
    specificity: winnerScore,
    candidateCount: candidates.length,
  };
}
