import { formatMoney } from "@/lib/formatters";

/**
 * GAP-ASSETS-CONDEMNATION-04/07: pure validation rules for the condemnation
 * workflow, kept apart from the component so they are unit-testable.
 */

export { isRealCalendarDate } from "@/lib/calendarDate";

export type AuctionCompletionErrors = { highestBid?: string; saleProceeds?: string };

/**
 * Business rules between the auction's money fields, on bigint paise strings:
 *  - the winning bid may not be below the auction's reserve (asset-service
 *    refuses it with BID_BELOW_FLOOR, asynchronously, so catch it here);
 *  - the sale proceeds posted to finance may not exceed the winning bid.
 * Inputs may be null while a field is still invalid -- that field is skipped.
 */
export function checkAuctionCompletion(input: {
  bidMinor: string | null;
  proceedsMinor: string | null;
  reserveMinor: string | null;
}): AuctionCompletionErrors {
  const out: AuctionCompletionErrors = {};
  const { bidMinor, proceedsMinor, reserveMinor } = input;
  if (bidMinor !== null && reserveMinor !== null && /^\d+$/.test(reserveMinor) && BigInt(bidMinor) < BigInt(reserveMinor)) {
    out.highestBid = `The winning bid is below the auction reserve of ${formatMoney(reserveMinor)}. An auction cannot be completed below its reserve.`;
  }
  if (bidMinor !== null && proceedsMinor !== null && BigInt(proceedsMinor) > BigInt(bidMinor)) {
    out.saleProceeds = "Sale proceeds cannot be more than the winning bid.";
  }
  return out;
}
