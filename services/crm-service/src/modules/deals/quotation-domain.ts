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

/**
 * F4-03: the small allow-list of ISO-4217 currencies a product / price book / quotation
 * may carry. Single source of truth, shared with products + price-books. A quotation is
 * single-currency: every line and the header must agree.
 */
export const ALLOWED_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;
export type AllowedCurrency = (typeof ALLOWED_CURRENCIES)[number];

export function isAllowedCurrency(code: string): code is AllowedCurrency {
  return (ALLOWED_CURRENCIES as readonly string[]).includes(code.toUpperCase());
}

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
  /** Tax rate in basis points (1 bp = 0.01%). Absent/0 means a zero-tax line. */
  taxRateBps?: number | undefined;
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

/**
 * F4-01: per-line NET (pre-tax) amount in paise. unitPrice (paise) * quantity, BigInt
 * throughout so a large value stays exact above 2^53.
 */
export function lineNetMinor(item: QuotationLineItem): bigint {
  return BigInt(item.unitPriceMinor) * BigInt(item.quantity);
}

/**
 * F4-01: per-line TAX in paise = round(net * bps / 10000), round-half-up — the SAME
 * rounding the web's lineTaxMinor uses (net*bps + 5000) / 10000. BigInt only; no float
 * touches a money value. A missing/zero rate yields 0.
 */
export function lineTaxMinor(item: QuotationLineItem): bigint {
  const net = lineNetMinor(item);
  const bps = BigInt(Math.max(0, Math.trunc(item.taxRateBps ?? 0)));
  if (bps === 0n) return 0n;
  return (net * bps + 5000n) / 10000n;
}

/** F4-01: sum of per-line tax across the quotation, in paise (BigInt, no float). */
export function sumLineTax(items: readonly QuotationLineItem[]): bigint {
  let total = 0n;
  for (const item of items) total += lineTaxMinor(item);
  return total;
}

/**
 * F4-01: the three money figures a quotation carries, all bigint paise:
 *  - netMinor:        pre-tax subtotal (what total_minor has always meant)
 *  - taxMinor:        sum of per-line tax
 *  - grandTotalMinor: netMinor + taxMinor (tax-inclusive)
 */
export interface QuotationTotals {
  netMinor: bigint;
  taxMinor: bigint;
  grandTotalMinor: bigint;
}

export function computeTotals(items: readonly QuotationLineItem[]): QuotationTotals {
  const netMinor = sumLineItems(items);
  const taxMinor = sumLineTax(items);
  return { netMinor, taxMinor, grandTotalMinor: netMinor + taxMinor };
}

/**
 * F4-02: GST split of a single line's tax into CGST/SGST/IGST, in paise.
 *
 * Intra-state (place of supply == supplier state): CGST = SGST = tax/2. An odd paisa
 * (tax not divisible by 2) is assigned to SGST, documented and deterministic, so
 * CGST + SGST == tax exactly.
 * Inter-state (place of supply != supplier state, or either unknown → treated as
 * inter-state since no same-state claim can be made): IGST = tax, CGST = SGST = 0.
 *
 * All arithmetic is BigInt paise.
 */
export interface GstSplit {
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
}

export function isIntraState(
  placeOfSupply: string | null | undefined,
  supplierState: string | null | undefined,
): boolean {
  const pos = (placeOfSupply ?? "").trim().toUpperCase();
  const sup = (supplierState ?? "").trim().toUpperCase();
  if (pos === "" || sup === "") return false;
  return pos === sup;
}

export function gstSplit(
  taxMinor: bigint,
  placeOfSupply: string | null | undefined,
  supplierState: string | null | undefined,
): GstSplit {
  if (taxMinor <= 0n) return { cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n };
  if (isIntraState(placeOfSupply, supplierState)) {
    const cgst = taxMinor / 2n; // floor
    const sgst = taxMinor - cgst; // odd paisa goes to SGST
    return { cgstMinor: cgst, sgstMinor: sgst, igstMinor: 0n };
  }
  return { cgstMinor: 0n, sgstMinor: 0n, igstMinor: taxMinor };
}

/** A quote is expired once validUntil has passed. Pure — `now` is injected. */
export function isExpired(validUntil: Date | null, now: Date): boolean {
  if (validUntil === null) return false;
  return validUntil.getTime() <= now.getTime();
}
