/**
 * Completeness scoring — pure domain function.
 *
 * Computes a 0–100 data quality score based on which required fields
 * are populated on a contact record. Used by the DQ-004 data quality
 * dashboard and the per-record completeness API.
 *
 * LM-001: the weights are now per-tenant configuration (crm.lead_field_rules).
 * They are passed IN rather than loaded here so this stays pure and testable —
 * the route does the reading. A tenant that has configured nothing falls back to
 * the defaults below, so existing behaviour is unchanged.
 */

/** Default weights, used when a tenant has configured none (sum = 100). */
export const DEFAULT_FIELD_WEIGHTS: ReadonlyArray<{ field: string; weight: number }> = [
  { field: "name", weight: 20 },
  { field: "email", weight: 20 },
  { field: "phone", weight: 15 },
  { field: "company", weight: 15 },
  { field: "designation", weight: 10 },
  { field: "city", weight: 10 },
  { field: "leadSource", weight: 10 },
] as const;

/** A configured rule as far as scoring is concerned. */
export interface CompletenessRule {
  fieldName: string;
  weight: number;
  enabled: boolean;
}

export interface CompletenessResult {
  score: number;
  missingFields: string[];
  filledFields: string[];
  totalFields: number;
}

/**
 * Turn configured rules into the weighted field list used for scoring.
 *
 * The set of scored fields is decided by `enabled`, and only by `enabled`. Weight
 * decides relative importance *within* that set, never membership of it.
 *
 * This used to filter on `enabled && weight > 0` and fall back to the defaults when
 * nothing survived, which contradicted enforcement: `weight` defaults to 0 in the DB,
 * so a tenant that declared name/phone/company required without ever touching weights
 * got creation enforcing all three while scoring ignored all three and silently scored
 * against the seven built-ins instead. A lead satisfying every rule the tenant had
 * configured scored 50 and the DQ-004 dashboard reported fields the tenant does not
 * govern as missing.
 *
 * So: no weights configured at all means "these fields matter equally" (weight 1 each),
 * not "nothing matters". The only fallback to the built-ins is when nothing is governed
 * — zero rules, or every rule disabled — because scoring 0 out of 0 fields is not a
 * number anybody can act on.
 */
export function resolveWeights(
  rules: ReadonlyArray<CompletenessRule> = [],
): ReadonlyArray<{ field: string; weight: number }> {
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return DEFAULT_FIELD_WEIGHTS;
  const anyPositive = enabled.some((r) => r.weight > 0);
  return enabled.map((r) => ({ field: r.fieldName, weight: anyPositive ? r.weight : 1 }));
}

/**
 * Compute completeness for a set of contact attributes.
 * A field is considered "present" if it is a non-null, non-undefined,
 * non-empty-string value.
 *
 * `rules` is the tenant's configuration; omit it for the built-in defaults.
 */
export function computeCompleteness(
  attributes: Record<string, unknown>,
  rules: ReadonlyArray<CompletenessRule> = [],
): CompletenessResult {
  const weights = resolveWeights(rules);
  const missingFields: string[] = [];
  const filledFields: string[] = [];
  let earned = 0;
  let total = 0;

  for (const { field, weight } of weights) {
    total += weight;
    const value = attributes[field];
    // Treat null, undefined, and empty string as "missing"
    const present = value !== null && value !== undefined && value !== "";
    if (present) {
      filledFields.push(field);
      earned += weight;
    } else {
      missingFields.push(field);
    }
  }

  // Normalised because configured weights need not sum to 100 — a tenant may
  // govern only a subset of fields, and a score of 45/60 must still read as a
  // percentage rather than as "45% complete against an invisible denominator".
  const score = total > 0 ? Math.round((earned / total) * 100) : 0;

  return {
    score: Math.min(score, 100),
    missingFields,
    filledFields,
    totalFields: weights.length,
  };
}
