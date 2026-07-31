/**
 * Rate effective-date resolution logic.
 * Given a list of rates for a product, determines the applicable rate for a specific date.
 * Handles overlap detection and "as-of" lookups.
 */

export interface RateEntry {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rateValueMinor: bigint;
  source: string;
  version: number;
}

/**
 * Find the rate effective as-of a given date. The date must fall within [effectiveFrom, effectiveTo].
 * If effectiveTo is null, the rate is open-ended (still current).
 */
export function resolveEffectiveRate(rates: RateEntry[], asOfDate: string): RateEntry | null {
  const d = asOfDate;
  const applicable = rates.filter((r) => {
    if (r.effectiveFrom > d) return false;
    if (r.effectiveTo !== null && r.effectiveTo < d) return false;
    return true;
  });
  if (applicable.length === 0) return null;
  // If multiple overlap, pick the one with the latest effectiveFrom (most specific)
  applicable.sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? -1 : 1));
  return applicable[0] ?? null;
}

/**
 * Detect if a new rate entry overlaps with any existing rate for the same product.
 * Returns the ids of conflicting rates.
 */
export function detectOverlaps(
  existing: RateEntry[],
  newFrom: string,
  newTo: string | null,
): string[] {
  const conflicts: string[] = [];
  for (const r of existing) {
    const rEnd = r.effectiveTo ?? "9999-12-31";
    const nEnd = newTo ?? "9999-12-31";
    // Overlap: newFrom <= rEnd AND nEnd >= rFrom
    if (newFrom <= rEnd && nEnd >= r.effectiveFrom) {
      conflicts.push(r.id);
    }
  }
  return conflicts;
}
