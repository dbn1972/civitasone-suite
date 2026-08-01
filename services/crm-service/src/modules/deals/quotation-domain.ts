/**
 * Pure quotation state machine + money maths (QP-003, QP-005).
 *
 * draft → sent → accepted | rejected | expired
 *
 * `accepted` and `rejected` are terminal: the customer decision is a contractual
 * fact. A changed price is a NEW version (version_number + 1), never a mutation
 * of a decided quote.
 *
 * MONEY: every amount here is bigint MINOR units (paise). No `number` appears in
 * any arithmetic path, so totals above 2^53 stay exact.
 */

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** Minimum characters required in a rejection reason. */
export const REJECT_REASON_MIN_LENGTH = 10;

const TRANSITIONS: Readonly<Record<QuotationStatus, readonly QuotationStatus[]>> = {
  draft: ["sent"],
  sent: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  // Expired quotes are historical records; a customer who comes back gets a new
  // version rather than a resurrected one.
  expired: [],
};

export function isQuotationStatus(value: string): value is QuotationStatus {
  return (QUOTATION_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: QuotationStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function allowedNextStatuses(status: QuotationStatus): readonly QuotationStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: QuotationStatus, to: QuotationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function requiresRejectReason(to: QuotationStatus): boolean {
  return to === "rejected";
}

export function isValidRejectReason(reason: string | undefined | null): boolean {
  return (reason ?? "").trim().length >= REJECT_REASON_MIN_LENGTH;
}

/** A quotation line: quantity is a count, unitPriceMinor is paise as a string. */
export interface QuotationLineItem {
  description: string;
  quantity: number;
  unitPriceMinor: string;
}

/**
 * Sums line items into a bigint total of minor units.
 * Quantity is coerced through BigInt (not multiplied as a float) so a large
 * unit price times a large quantity never loses precision.
 */
export function sumLineItems(items: readonly QuotationLineItem[]): bigint {
  let total = 0n;
  for (const item of items) {
    total += BigInt(item.unitPriceMinor) * BigInt(item.quantity);
  }
  return total;
}

/** A quote is expired once validUntil has passed. Pure — `now` is injected. */
export function isExpired(validUntil: Date | null, now: Date): boolean {
  if (validUntil === null) return false;
  return validUntil.getTime() <= now.getTime();
}
