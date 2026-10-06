/**
 * Revenue collection channels — shared labels + metadata.
 *
 * GAP-REVENUE-RECEIPTS-04: the Record Receipt form previously rendered the raw
 * channel codes ("dd", "pos") in the select, and showed the instrument/bank
 * fields for every channel including online/counter. This module is the single
 * source of truth for the human label of each channel and for which channels
 * actually need a bank instrument (cheque / demand draft).
 */

export const REVENUE_CHANNELS = ["online", "counter", "cheque", "dd", "pos"] as const;
export type RevenueChannel = (typeof REVENUE_CHANNELS)[number];

/**
 * GAP-REVENUE-BBPS-04: BBPS payments use a different channel set from counter
 * receipts (digital rails rather than paper instruments). Kept here so both
 * forms share one labelled vocabulary and submit the code while showing the
 * label.
 */
export const BBPS_CHANNELS = ["online", "counter", "upi", "netbanking", "card"] as const;
export type BbpsChannel = (typeof BBPS_CHANNELS)[number];

const CHANNEL_LABELS: Record<string, string> = {
  online: "Online",
  counter: "Counter (cash)",
  cheque: "Cheque",
  dd: "Demand draft",
  pos: "POS terminal",
  upi: "UPI",
  netbanking: "Net banking",
  card: "Card",
};

/** Human label for a collection channel code; unknown codes fall back to the raw code. */
export function channelLabel(channel: string): string {
  return (CHANNEL_LABELS as Record<string, string>)[channel] ?? channel;
}

/**
 * Channels drawn on a bank instrument (a physical/dematerialised paper), where
 * an instrument number and bank name are meaningful and should be required.
 * Online/counter/POS carry no such instrument.
 */
const INSTRUMENT_CHANNELS = new Set<string>(["cheque", "dd"]);

export function channelNeedsInstrument(channel: string): boolean {
  return INSTRUMENT_CHANNELS.has(channel);
}

/**
 * GAP-REVENUE-RECEIPTS-02: receipt statuses that represent money actually
 * collected and still standing — i.e. that should be summed into "Total
 * Collected". A reversed/cancelled receipt is NOT collected revenue and must
 * be excluded so the figure next to "Reconciled" is not inflated.
 *
 * The revenue-service receipt status enum is: captured, reconciled, reversed
 * (collection.receipts.status, default "captured" — see
 * services/revenue-service/src/modules/collection/schema.ts). "captured" and
 * "reconciled" are standing collections; "reversed" is not. Decided
 * conservatively: any status NOT in this allow-list is excluded from the total
 * (fail closed on an unknown status rather than over-counting).
 */
export const COLLECTED_RECEIPT_STATUSES = new Set<string>(["captured", "reconciled"]);

export function isCollectedStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && COLLECTED_RECEIPT_STATUSES.has(status);
}
