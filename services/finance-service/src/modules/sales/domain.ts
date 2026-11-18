/**
 * MSME commercial M2 -- pure sales-invoicing rules (no DB, no I/O). Money is bigint paise end to end.
 *
 * GST scope: REGULAR registration only. There is no composition / bill-of-supply branch in this version.
 * The intra-/inter-state CGST + SGST vs IGST split is computed with @civitasone/gst (the single copy of the billing rule) and
 * re-validated with validateGstSplit / validateGstHeads before it is stored on the document; M3b posts the GST output GL
 * line from the STORED split and never recomputes it.
 *
 * Every statutory default here (rounding, the s.34 limit, time of supply) is VERIFY-by-CA (docs/MSME-STATUTORY-CONFIG.md):
 * it is isolated in one function so the CA's answer is a one-line change.
 */
import { splitIntraStateTax, validateGstHeads, validateGstSplit } from "@civitasone/gst";
import { financialYear, type NumberFormatSpec } from "@civitasone/numbering";
import { DomainError } from "../approvals/domain.js";
import type { SupplyType } from "./schema.js";

// ---- amounts -------------------------------------------------------------------------------------------------------------------

/** Quantity "12.5" -> thousandths (12500n). At most 3 decimals, > 0. */
export function qtyMilli(q: string | number): bigint {
  const s = typeof q === "number" ? String(q) : q.trim();
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(s)) throw new DomainError("INVOICE_QTY", `quantity '${s}' must be a positive number with at most 3 decimals`);
  const [i = "0", f = ""] = s.split(".");
  const v = BigInt(i) * 1000n + BigInt(f.padEnd(3, "0"));
  if (v <= 0n) throw new DomainError("INVOICE_QTY", "quantity must be greater than zero");
  return v;
}

/** GST rate "18" / "0.25" -> hundredths of a percent (1800n / 25n). */
export function rateHundredths(pct: string | number): bigint {
  const s = typeof pct === "number" ? String(pct) : pct.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw new DomainError("INVOICE_RATE", `GST rate '${s}' must be a percentage with at most 2 decimals`);
  const [i = "0", f = ""] = s.split(".");
  const v = BigInt(i) * 100n + BigInt(f.padEnd(2, "0"));
  if (v > 10000n) throw new DomainError("INVOICE_RATE", "GST rate cannot exceed 100%");
  return v;
}

/** Round-half-up integer division for non-negative operands. */
const divRound = (n: bigint, d: bigint): bigint => (n * 2n + d) / (d * 2n);

export interface LineInput { qty: string | number; rateMinor: bigint; discountMinor?: bigint; gstRatePct: string | number }
export interface LineAmounts { taxableMinor: bigint; taxMinor: bigint; totalMinor: bigint; ratePct: string }

/** taxable = round(qty * rate) - discount; tax = round(taxable * rate%). Rounded per line, half-up (VERIFY-by-CA). */
export function computeLine(l: LineInput): LineAmounts {
  if (l.rateMinor < 0n) throw new DomainError("INVOICE_RATE", "unit rate cannot be negative");
  const discount = l.discountMinor ?? 0n;
  if (discount < 0n) throw new DomainError("INVOICE_DISCOUNT", "discount cannot be negative");
  const gross = divRound(qtyMilli(l.qty) * l.rateMinor, 1000n);
  if (discount > gross) throw new DomainError("INVOICE_DISCOUNT", "discount cannot exceed the line value");
  const taxable = gross - discount;
  const hundredths = rateHundredths(l.gstRatePct);
  const tax = divRound(taxable * hundredths, 10000n);
  const ratePct = `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`;
  return { taxableMinor: taxable, taxMinor: tax, totalMinor: taxable + tax, ratePct };
}

// ---- the stored GST split ------------------------------------------------------------------------------------------------------

export interface GstSplit { supplyType: SupplyType; cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint; taxMinor: bigint }

export interface SplitContext {
  /** The tenant is GST-registered (stored setting). When false no GST line exists: tax is zero and supplyType is 'none'. */
  gstRegistered: boolean;
  supplierGstin: string | null;
  placeOfSupply: string;
  /** Present for a B2B supply; a B2C bill has none (validateGstHeads is used instead of validateGstSplit). */
  customerGstin: string | null;
}

/**
 * Split `taxMinor` into CGST + SGST (intra-state: supplier state == place of supply) or IGST (inter-state), then validate the
 * result with @civitasone/gst. Throws a DomainError when the rule cannot be satisfied (e.g. an invalid GSTIN).
 */
export function splitTax(taxMinor: bigint, c: SplitContext): GstSplit {
  if (!c.gstRegistered) {
    if (taxMinor !== 0n) throw new DomainError("INVOICE_GST_NOT_REGISTERED", "this business is not GST-registered: an invoice cannot carry GST");
    return { supplyType: "none", cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, taxMinor: 0n };
  }
  if (!c.supplierGstin) throw new DomainError("INVOICE_SUPPLIER_GSTIN", "the business GSTIN is not recorded in finance settings");
  const intra = c.supplierGstin.slice(0, 2) === c.placeOfSupply;
  const s = intra ? splitIntraStateTax(taxMinor) : { cgstMinor: 0n, sgstMinor: 0n };
  const out: GstSplit = {
    supplyType: intra ? "intra" : "inter",
    cgstMinor: s.cgstMinor, sgstMinor: s.sgstMinor, igstMinor: intra ? 0n : taxMinor, taxMinor,
  };
  const detail = { supplierGstin: c.supplierGstin, placeOfSupply: c.placeOfSupply, cgstMinor: out.cgstMinor, sgstMinor: out.sgstMinor, igstMinor: out.igstMinor };
  const err = c.customerGstin
    ? validateGstSplit({ ...detail, recipientGstin: c.customerGstin }, taxMinor)
    : validateGstHeads(detail, taxMinor);
  if (err) throw new DomainError("INVOICE_GST_SPLIT", err);
  return out;
}

export interface InvoiceTotals extends GstSplit { taxableMinor: bigint; totalMinor: bigint; lines: LineAmounts[] }

/** Totals of all lines + the invoice-level split (the split is taken on the invoice total, so the stored heads always satisfy validateGstHeads). */
export function computeInvoice(lines: LineInput[], c: SplitContext): InvoiceTotals {
  if (lines.length === 0) throw new DomainError("INVOICE_NO_LINES", "an invoice needs at least one line");
  const amounts = lines.map((l) => computeLine(c.gstRegistered ? l : { ...l, gstRatePct: 0 }));
  const taxable = amounts.reduce((a, l) => a + l.taxableMinor, 0n);
  const tax = amounts.reduce((a, l) => a + l.taxMinor, 0n);
  const split = splitTax(tax, c);
  return { ...split, taxableMinor: taxable, totalMinor: taxable + tax, lines: amounts };
}

// ---- credit / debit notes (s.34) -----------------------------------------------------------------------------------------------

/**
 * s.34 time limit for a credit note to reduce the supplier's output tax: 30 November following the end of the financial year of
 * the ORIGINAL invoice. (The statute also says "or the date of furnishing the annual return, whichever is earlier" -- not tracked
 * here; VERIFY-by-CA.) A debit note has no such limit but the same date is stored for symmetry.
 */
export function s34Cutoff(invoiceDate: string): string {
  const y = Number(invoiceDate.slice(0, 4));
  const m = Number(invoiceDate.slice(5, 7));
  const fyEndYear = m >= 4 ? y + 1 : y;
  return `${fyEndYear}-11-30`;
}

export function withinS34(invoiceDate: string, noteDate: string): boolean {
  return noteDate <= s34Cutoff(invoiceDate);
}

/** Tax of a note: the invoice's supply type decides the heads (a note never changes the place of supply of the original). */
export function computeNote(taxableMinor: bigint, gstRatePct: string | number, invoiceSupply: SupplyType, supplierGstin: string | null, placeOfSupply: string, customerGstin: string | null): GstSplit & { taxableMinor: bigint; totalMinor: bigint } {
  if (taxableMinor <= 0n) throw new DomainError("NOTE_AMOUNT", "a note must be for an amount greater than zero");
  const tax = invoiceSupply === "none" ? 0n : divRound(taxableMinor * rateHundredths(gstRatePct), 10000n);
  const split = splitTax(tax, { gstRegistered: invoiceSupply !== "none", supplierGstin, placeOfSupply, customerGstin });
  return { ...split, taxableMinor, totalMinor: taxableMinor + tax };
}

// ---- ageing --------------------------------------------------------------------------------------------------------------------

export const AGEING_BUCKETS = ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

const MS_DAY = 86_400_000;
export const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_DAY);

/** Bucket by days past the due date as of `asOf`. Not yet due (or due today) = not_due. */
export function ageingBucket(dueDate: string, asOf: string): AgeingBucket {
  const d = daysBetween(dueDate, asOf);
  if (d <= 0) return "not_due";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90_plus";
}

// ---- Rule 46 numbering ---------------------------------------------------------------------------------------------------------

export const DOC_TYPES = {
  sales_invoice: "INV", credit_note: "CN", debit_note: "DN", advance_receipt: "RV",
} as const;
export type DocType = keyof typeof DOC_TYPES;

/** packages/numbering counter table layout (migration 0176). */
export const AR_SEQ_CONFIG = { schema: "ar", table: "doc_counters", keyCol: "doc_type", bucketCol: "bucket", valueCol: "last_seq", updatedAtCol: "updated_at" } as const;

export function specFor(t: DocType): NumberFormatSpec {
  return { prefix: DOC_TYPES[t], embedFinancialYear: true, fyStartMonth: 4, counterWidth: 6, separator: "/", resetPolicy: "yearly" };
}

/**
 * Rule 46 limits a serial number to 16 characters of [A-Za-z0-9/-], unique per financial year. "INV/2627/000001" is 15.
 * The counter bucket is the full financial year ("2026-27"); only the printed segment is shortened.
 */
export function fySegment(at: Date): string {
  const fy = financialYear(at, 4); // "2026-27"
  return `${fy.slice(2, 4)}${fy.slice(5, 7)}`;
}

/** Noon IST on the document date: the instant the number is minted for (so the FY follows the document date, not the server clock). */
export const mintInstant = (isoDate: string): Date => new Date(`${isoDate}T12:00:00+05:30`);

export function assertRule46(no: string): void {
  if (!/^[A-Z0-9/-]{1,16}$/.test(no)) throw new DomainError("DOC_NO_RULE46", `document number '${no}' breaks Rule 46 (max 16 chars of letters, digits, '/' and '-')`);
}
