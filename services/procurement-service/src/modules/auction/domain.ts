export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export interface BidInput {
  id: string;
  vendorId: string;
  bidMinor: bigint;
  isMse: boolean;
  /** Submission time, used as the deterministic tie-break (earliest wins). */
  bidAt?: Date | string | number;
  /** Whether the vendor is eligible (not blacklisted / disqualified). Default true. */
  eligible?: boolean;
}

// GFR Rule 153: 15% price preference to MSE vendors — their effective price is
// bid × 0.85. Integer-only: bidMinor*85/100 with floor (round-down) rounding so
// the preference never overshoots and the result is exact for large bids.
export const MSE_PREF_NUM = 85n;
export const MSE_PREF_DEN = 100n;

export function computeEffectivePrice(bidMinor: bigint, isMse: boolean, msePreference: boolean): bigint {
  if (isMse && msePreference) {
    return (bidMinor * MSE_PREF_NUM) / MSE_PREF_DEN; // BigInt division truncates toward zero (floor for non-negatives)
  }
  return bidMinor;
}

function tieBreakKey(b: BidInput): number {
  const t = b.bidAt instanceof Date ? b.bidAt.getTime() : b.bidAt != null ? new Date(b.bidAt).getTime() : Number.MAX_SAFE_INTEGER;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * Rank eligible bids only (#11): blacklisted/disqualified vendors are filtered
 * out before ranking and never receive a rank. Deterministic tie-break (#11):
 * equal effective price → earliest submission wins; final fallback is bid id.
 */
export function rankBids(bids: BidInput[], msePreference: boolean): Array<BidInput & { effectiveMinor: bigint; rank: number }> {
  const ranked = bids
    .filter((b) => b.eligible !== false)
    .map((b) => ({ ...b, effectiveMinor: computeEffectivePrice(b.bidMinor, b.isMse, msePreference) }))
    .sort((a, b) => {
      if (a.effectiveMinor !== b.effectiveMinor) return a.effectiveMinor < b.effectiveMinor ? -1 : 1;
      const ta = tieBreakKey(a), tb = tieBreakKey(b);
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  return ranked.map((b, i) => ({ ...b, rank: i + 1 }));
}
