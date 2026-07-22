/**
 * Tender domain logic — authority routing, quotation comparison.
 */

export interface Quotation {
  contractorName: string;
  quotedAmountMinor: bigint;
  method: string;
}

/**
 * Determine the approving authority tier based on tender amount.
 */
export function resolveApprovingAuthority(tenderAmountMinor: bigint): string {
  if (tenderAmountMinor <= 500_000_00n) return "section_officer"; // up to 5 lakh
  if (tenderAmountMinor <= 25_00_000_00n) return "sdo";           // up to 25 lakh
  if (tenderAmountMinor <= 1_00_00_000_00n) return "do";          // up to 1 crore
  return "dao";                                                    // above 1 crore
}

/**
 * Compare quotations and find the lowest bidder (L1).
 */
export function findLowestBidder(quotations: Quotation[]): Quotation | null {
  if (quotations.length === 0) return null;
  return quotations.reduce((lowest, q) =>
    q.quotedAmountMinor < lowest.quotedAmountMinor ? q : lowest
  );
}

/**
 * Check if a pre-tender can be finalized.
 */
export function canFinalizePreTender(status: string): { allowed: boolean; reason?: string } {
  if (status !== "draft") {
    return { allowed: false, reason: `Cannot finalize: current status is '${status}', must be 'draft'` };
  }
  return { allowed: true };
}
