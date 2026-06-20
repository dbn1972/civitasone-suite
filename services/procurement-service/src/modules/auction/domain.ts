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
}

// GFR Rule 153: 15% price preference to MSE vendors — their effective price is bid * 0.85
export const MSE_PREFERENCE_FACTOR = 0.85;

export function computeEffectivePrice(bidMinor: bigint, isMse: boolean, msePreference: boolean): bigint {
  if (isMse && msePreference) {
    return BigInt(Math.floor(Number(bidMinor) * MSE_PREFERENCE_FACTOR));
  }
  return bidMinor;
}

export function rankBids(bids: BidInput[], msePreference: boolean): Array<BidInput & { effectiveMinor: bigint; rank: number }> {
  const ranked = bids
    .map((b) => ({ ...b, effectiveMinor: computeEffectivePrice(b.bidMinor, b.isMse, msePreference) }))
    .sort((a, b) => (a.effectiveMinor < b.effectiveMinor ? -1 : a.effectiveMinor > b.effectiveMinor ? 1 : 0));
  return ranked.map((b, i) => ({ ...b, rank: i + 1 }));
}
