/**
 * matrix/domain.ts — Pure validation for cross-sell matrix entries.
 *
 * A matrix entry says "when a customer owns product A, recommend product B",
 * optionally narrowed to a segment and/or a delivery channel.
 */

export interface MatrixScope {
  /** Optional customer segment the rule applies to. */
  segment?: string | null;
  /** Optional delivery channel the rule applies to. */
  channel?: string | null;
}

export interface MatrixKey extends MatrixScope {
  triggerProductId: string;
  recommendedProductId: string;
}

export interface MatrixEntryInput extends MatrixKey {
  priority: number;
}

/** Longest accepted segment/channel value — matches varchar(64) in the schema. */
export const MAX_SCOPE_LENGTH = 64;

/**
 * Normalise an optional scope value so null, undefined and "" all collapse to
 * the same key, and comparison is case/whitespace insensitive.
 */
export function normaliseScopeValue(value?: string | null): string {
  if (value === undefined || value === null) return "";
  return value.trim().toLowerCase();
}

function validateScopeValue(label: string, value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return `${label} must be a string`;
  if (value.trim().length === 0) return `${label} must not be blank`;
  if (value.length > MAX_SCOPE_LENGTH) return `${label} must not exceed ${MAX_SCOPE_LENGTH} characters`;
  return null;
}

/**
 * Validate a matrix entry. Returns null when valid, otherwise a human message
 * suitable for a 422 response.
 */
export function validateMatrixEntry(entry: MatrixEntryInput): string | null {
  if (typeof entry.triggerProductId !== "string" || entry.triggerProductId.trim().length === 0) {
    return "triggerProductId is required";
  }
  if (typeof entry.recommendedProductId !== "string" || entry.recommendedProductId.trim().length === 0) {
    return "recommendedProductId is required";
  }
  if (entry.triggerProductId === entry.recommendedProductId) {
    return "trigger and recommended product must differ";
  }
  if (!Number.isFinite(entry.priority) || !Number.isInteger(entry.priority) || entry.priority < 0) {
    return "priority must be a non-negative integer";
  }

  const segmentError = validateScopeValue("segment", entry.segment);
  if (segmentError) return segmentError;

  const channelError = validateScopeValue("channel", entry.channel);
  if (channelError) return channelError;

  return null;
}

/** Stable comparison key for duplicate detection. */
export function matrixKeyOf(entry: MatrixKey): string {
  return [
    entry.triggerProductId,
    entry.recommendedProductId,
    normaliseScopeValue(entry.segment),
    normaliseScopeValue(entry.channel),
  ].join("|");
}

/**
 * Find an existing entry that collides with `candidate` on
 * (triggerProductId, recommendedProductId, segment, channel).
 * Returns the colliding entry, or null when the candidate is unique.
 */
export function detectDuplicate<T extends MatrixKey>(
  existing: readonly T[],
  candidate: MatrixKey,
): T | null {
  const key = matrixKeyOf(candidate);
  for (const entry of existing) {
    if (matrixKeyOf(entry) === key) return entry;
  }
  return null;
}
