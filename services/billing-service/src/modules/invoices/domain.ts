export function shouldSkipInvoiceGeneration(govtExempt: boolean): boolean {
  return govtExempt;
}

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "waived"
  | "cancelled";

export type LineKind = "line" | "tax" | "charge";

export interface LineItemInput {
  description: string;
  /** HSN (goods) / SAC (services) code, 4/6/8 digits. */
  hsnSac?: string | undefined;
  amountMinor: number; // paise per unit
  quantity?: number;
  kind?: LineKind;
}

/**
 * Maker-checker threshold (paise). Issue/cancel of a bill at or above this value
 * requires a separate approver (maker != checker). Default ₹1,00,000.
 * Government billing: significant-value state changes are dual-controlled.
 */
export const APPROVAL_THRESHOLD_MINOR = BigInt(
  process.env.BILLING_APPROVAL_THRESHOLD_MINOR ?? "10000000",
);

export function requiresApproval(totalMinor: bigint): boolean {
  return totalMinor >= APPROVAL_THRESHOLD_MINOR;
}

/** A line counts toward the net total; tax/charge lines are summed separately. */
export function computeTotals(items: LineItemInput[]): {
  subtotalMinor: bigint;
  taxMinor: bigint;
  chargesMinor: bigint;
  totalMinor: bigint;
} {
  let subtotal = 0n;
  let tax = 0n;
  let charges = 0n;
  for (const it of items) {
    const qty = BigInt(it.quantity ?? 1);
    const amt = BigInt(it.amountMinor) * qty;
    if (it.kind === "tax") tax += amt;
    else if (it.kind === "charge") charges += amt;
    else subtotal += amt;
  }
  return { subtotalMinor: subtotal, taxMinor: tax, chargesMinor: charges, totalMinor: subtotal + tax + charges };
}

export function outstandingMinor(totalMinor: bigint, paidMinor: bigint): bigint {
  const o = totalMinor - paidMinor;
  return o > 0n ? o : 0n;
}

/**
 * Status after a payment of `amount` lands on a bill currently at `paid` of
 * `total`. Returns the new paid amount and resulting status. Caller has already
 * guarded against over-payment.
 */
export function applyPayment(
  totalMinor: bigint,
  currentPaidMinor: bigint,
  amountMinor: bigint,
): { paidMinor: bigint; status: Extract<InvoiceStatus, "partially_paid" | "paid"> } {
  const paid = currentPaidMinor + amountMinor;
  return { paidMinor: paid, status: paid >= totalMinor ? "paid" : "partially_paid" };
}

export function assertPayable(status: string): void {
  if (status !== "issued" && status !== "partially_paid") {
    throw new DomainError("INVOICE_NOT_PAYABLE", `cannot pay a bill in '${status}' state (must be issued/partially_paid)`);
  }
}

export function assertIssuable(status: string): void {
  if (status !== "draft") {
    throw new DomainError("INVOICE_NOT_ISSUABLE", `cannot issue a bill in '${status}' state (must be draft)`);
  }
}

export function assertCancellable(status: string): void {
  if (status === "paid" || status === "cancelled") {
    throw new DomainError("INVOICE_NOT_CANCELLABLE", `cannot cancel a bill in '${status}' state`);
  }
}

/** Over-payment guard: a receipt may not exceed the outstanding balance. */
export function assertWithinOutstanding(totalMinor: bigint, paidMinor: bigint, amountMinor: bigint): void {
  if (amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "payment amount must be positive");
  }
  if (amountMinor > outstandingMinor(totalMinor, paidMinor)) {
    throw new DomainError(
      "OVERPAYMENT",
      `payment ${amountMinor} paise exceeds outstanding ${outstandingMinor(totalMinor, paidMinor)} paise`,
    );
  }
}

// ── GST tax-invoice fields (owner decision #26) ──────────────────────────────

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const HSN_SAC_RE = /^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/;

export interface GstDetail {
  supplierGstin: string;
  recipientGstin: string;
  /** Two-digit GST state code of the place of supply. */
  placeOfSupply: string;
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
}

/**
 * Validate the CGST/SGST/IGST split against the tax lines. Intra-state supply (supplier
 * state == place of supply) is CGST + SGST in equal halves with no IGST; inter-state supply
 * is IGST only. The split must equal the invoice tax exactly. Returns an error string, or
 * null when valid.
 */
export function validateGstSplit(g: GstDetail, taxMinor: bigint): string | null {
  if (!GSTIN_RE.test(g.supplierGstin)) return "supplier GSTIN is not a valid 15-character GSTIN";
  if (!GSTIN_RE.test(g.recipientGstin)) return "recipient GSTIN is not a valid 15-character GSTIN";
  if (!/^[0-9]{2}$/.test(g.placeOfSupply)) return "place of supply must be a two-digit GST state code";
  if (g.cgstMinor < 0n || g.sgstMinor < 0n || g.igstMinor < 0n) return "tax components cannot be negative";
  if (g.cgstMinor + g.sgstMinor + g.igstMinor !== taxMinor) return "CGST + SGST + IGST must equal the invoice tax lines";
  const intraState = g.supplierGstin.slice(0, 2) === g.placeOfSupply;
  if (intraState) {
    if (g.igstMinor !== 0n) return "intra-state supply is CGST + SGST only; IGST must be zero";
    if (g.cgstMinor !== g.sgstMinor) return "CGST and SGST must be equal";
  } else if (g.cgstMinor !== 0n || g.sgstMinor !== 0n) {
    return "inter-state supply is IGST only; CGST and SGST must be zero";
  }
  return null;
}

/** Human invoice number derived from the period and the invoice id (stable, no extra sequence). */
export function invoiceNumber(periodMonth: string, id: string): string {
  return `INV-${periodMonth.replace("-", "")}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

// ── Sequential tax-invoice numbering (F11, CGST Rule 46) ─────────────────────

/** Series key for an invoice with no supplier GSTIN (non-GST legacy shape). */
export const UNREGISTERED_SERIES = "UNREGISTERED";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Indian financial year (April to March) of an instant, in IST, as the two-digit start and end
 * years: 2026-04-01 IST .. 2027-03-31 IST is "2627". A UTC instant just before midnight IST on
 * 31 March is already 1 April in India, so the shift is applied before reading the month.
 */
export function fiscalYearCode(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return `${two(start)}${two(start + 1)}`;
}

/** INV-<FY>-<seq, 6 digits min>: at most 16 characters (Rule 46), letters, digits and hyphen only. */
export function formatSeriesInvoiceNumber(fiscalYear: string, seq: bigint): string {
  if (seq < 1n) throw new DomainError("INVALID_SEQUENCE", "invoice sequence must start at 1");
  const n = `INV-${fiscalYear}-${seq.toString().padStart(6, "0")}`;
  if (n.length > 16) throw new DomainError("INVOICE_SERIES_EXHAUSTED", "the invoice series for this financial year is exhausted");
  return n;
}
