/**
 * Completeness scoring — pure domain function.
 *
 * Computes a 0–100 data quality score based on which required fields
 * are populated on a contact record. Used by the DQ-004 data quality
 * dashboard and the per-record completeness API.
 */

/** Required fields and their contribution weights (sum = 100). */
const FIELD_WEIGHTS: ReadonlyArray<{ field: string; weight: number }> = [
  { field: "name", weight: 20 },
  { field: "email", weight: 20 },
  { field: "phone", weight: 15 },
  { field: "company", weight: 15 },
  { field: "designation", weight: 10 },
  { field: "city", weight: 10 },
  { field: "leadSource", weight: 10 },
] as const;

export interface CompletenessResult {
  score: number;
  missingFields: string[];
  filledFields: string[];
  totalFields: number;
}

/**
 * Compute completeness for a set of contact attributes.
 * A field is considered "present" if it is a non-null, non-undefined,
 * non-empty-string value.
 */
export function computeCompleteness(
  attributes: Record<string, unknown>,
): CompletenessResult {
  const missingFields: string[] = [];
  const filledFields: string[] = [];
  let score = 0;

  for (const { field, weight } of FIELD_WEIGHTS) {
    const value = attributes[field];
    // Treat null, undefined, and empty string as "missing"
    const present = value !== null && value !== undefined && value !== "";
    if (present) {
      filledFields.push(field);
      score += weight;
    } else {
      missingFields.push(field);
    }
  }

  return {
    score: Math.min(score, 100),
    missingFields,
    filledFields,
    totalFields: FIELD_WEIGHTS.length,
  };
}
