/**
 * GAP-ESTAB-APPROVAL-MATRIX-03 (owner decision B22): amount bands of the active rules of one source
 * type must not overlap. A band is half-open [min, max) in minor units, `max === null` = open-ended
 * (the same convention resolver.ts `inBand` reads).
 *
 * resolver.ts still resolves any overlap that pre-dates this check by precedence (highest min, then
 * lowest priority), so legacy rows keep routing deterministically; this only stops NEW overlaps
 * from being written.
 */
export type Band = { minAmountMinor: number; maxAmountMinor: number | null };

export function bandsOverlap(a: Band, b: Band): boolean {
  const aEndsBeforeB = a.maxAmountMinor !== null && a.maxAmountMinor <= b.minAmountMinor;
  const bEndsBeforeA = b.maxAmountMinor !== null && b.maxAmountMinor <= a.minAmountMinor;
  return !(aEndsBeforeB || bEndsBeforeA);
}

/** The first existing rule (other than `selfId`) whose band overlaps the candidate, else null. */
export function findOverlappingRule<R extends Band & { id: string }>(
  existing: ReadonlyArray<R>,
  candidate: Band,
  selfId?: string,
): R | null {
  for (const r of existing) {
    if (selfId !== undefined && r.id === selfId) continue;
    if (bandsOverlap(r, candidate)) return r;
  }
  return null;
}

export function describeBand(b: Band): string {
  return `[${b.minAmountMinor}, ${b.maxAmountMinor === null ? "no upper limit" : b.maxAmountMinor})`;
}
