/**
 * MSME commercial M2 -- pure domain rules (no DB): line / invoice maths, the stored CGST-SGST vs IGST split (via @civitasone/gst),
 * s.34 timing, ageing buckets, Rule 46 numbering, and the invoice document model. Static / unit; runs without Postgres.
 */
import { describe, it, expect } from "vitest";
import { formatReference } from "@civitasone/numbering";
import { validateGstHeads } from "@civitasone/gst";
import { EMPTY_DOC_IDENTITY } from "@civitasone/render/official";
import {
  qtyMilli, rateHundredths, computeLine, splitTax, computeInvoice, computeNote, s34Cutoff, withinS34, ageingBucket, specFor, fySegment, mintInstant, assertRule46,
} from "../src/modules/sales/domain.js";
import { buildInvoiceDoc, titleFor, type InvoiceDocModel } from "../src/modules/sales/invoice-pdf.js";

const SUPPLIER = "29ABCDE1234F1Z5";
const BUYER_KA = "29AAAAA0000A1Z5";
const BUYER_MH = "27BBBBB1111B1Z5";
const codeOf = (fn: () => unknown): string => { try { fn(); return "NO_ERROR"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

describe("amounts", () => {
  it("parses quantity to thousandths and rejects junk", () => {
    expect(qtyMilli("12.5")).toBe(12500n);
    expect(qtyMilli(3)).toBe(3000n);
    expect(codeOf(() => qtyMilli("0"))).toBe("INVOICE_QTY");
    expect(codeOf(() => qtyMilli("1.2345"))).toBe("INVOICE_QTY");
    expect(codeOf(() => qtyMilli("-1"))).toBe("INVOICE_QTY");
  });
  it("parses GST rate to hundredths of a percent", () => {
    expect(rateHundredths("18")).toBe(1800n);
    expect(rateHundredths("0.25")).toBe(25n);
    expect(rateHundredths(5)).toBe(500n);
    expect(codeOf(() => rateHundredths("101"))).toBe("INVOICE_RATE");
  });
  it("a line: taxable = qty*rate - discount, tax rounded half-up, taxable + tax = total", () => {
    const l = computeLine({ qty: "3", rateMinor: 100000n, gstRatePct: "18" });
    expect(l).toMatchObject({ taxableMinor: 300000n, taxMinor: 54000n, totalMinor: 354000n, ratePct: "18.00" });
    const half = computeLine({ qty: 1, rateMinor: 1005n, gstRatePct: 18 }); // 180.9 -> 181
    expect(half.taxMinor).toBe(181n);
    expect(half.taxableMinor + half.taxMinor).toBe(half.totalMinor);
    expect(computeLine({ qty: "2.5", rateMinor: 1000n, discountMinor: 500n, gstRatePct: 0 }).taxableMinor).toBe(2000n);
    expect(codeOf(() => computeLine({ qty: 1, rateMinor: 100n, discountMinor: 200n, gstRatePct: 5 }))).toBe("INVOICE_DISCOUNT");
  });
});

describe("the stored GST split (@civitasone/gst)", () => {
  const ctx = (placeOfSupply: string, customerGstin: string | null) => ({ gstRegistered: true, supplierGstin: SUPPLIER, placeOfSupply, customerGstin });
  it("intra-state (supplier state == place of supply): CGST + SGST, no IGST, equal halves", () => {
    const s = splitTax(54000n, ctx("29", BUYER_KA));
    expect(s).toMatchObject({ supplyType: "intra", cgstMinor: 27000n, sgstMinor: 27000n, igstMinor: 0n });
  });
  it("an odd intra-state tax splits CGST rounded down, SGST rounded up, and the result passes validateGstHeads", () => {
    const s = splitTax(54181n, ctx("29", null));
    expect(s).toMatchObject({ cgstMinor: 27090n, sgstMinor: 27091n, igstMinor: 0n });
    expect(validateGstHeads({ supplierGstin: SUPPLIER, placeOfSupply: "29", cgstMinor: s.cgstMinor, sgstMinor: s.sgstMinor, igstMinor: s.igstMinor }, 54181n)).toBeNull();
  });
  it("inter-state: IGST only", () => {
    expect(splitTax(54000n, ctx("27", BUYER_MH))).toMatchObject({ supplyType: "inter", cgstMinor: 0n, sgstMinor: 0n, igstMinor: 54000n });
  });
  it("a B2B recipient with an invalid GSTIN is refused; a B2C bill needs none", () => {
    expect(codeOf(() => splitTax(100n, ctx("29", "NOT-A-GSTIN")))).toBe("INVOICE_GST_SPLIT");
    expect(splitTax(100n, ctx("29", null)).supplyType).toBe("intra");
  });
  it("an unregistered business carries no GST at all", () => {
    expect(splitTax(0n, { gstRegistered: false, supplierGstin: null, placeOfSupply: "29", customerGstin: null })).toMatchObject({ supplyType: "none", taxMinor: 0n });
    expect(codeOf(() => splitTax(10n, { gstRegistered: false, supplierGstin: null, placeOfSupply: "29", customerGstin: null }))).toBe("INVOICE_GST_NOT_REGISTERED");
    const inv = computeInvoice([{ qty: 1, rateMinor: 5000n, gstRatePct: 18 }], { gstRegistered: false, supplierGstin: null, placeOfSupply: "29", customerGstin: null });
    expect(inv).toMatchObject({ taxableMinor: 5000n, taxMinor: 0n, totalMinor: 5000n, supplyType: "none" });
  });
  it("the invoice split is taken on the invoice total, so multi-line odd paise still validate", () => {
    const inv = computeInvoice(
      [{ qty: 1, rateMinor: 1005n, gstRatePct: 18 }, { qty: 1, rateMinor: 1005n, gstRatePct: 18 }, { qty: 1, rateMinor: 1005n, gstRatePct: 18 }],
      { gstRegistered: true, supplierGstin: SUPPLIER, placeOfSupply: "29", customerGstin: null },
    );
    expect(inv.taxMinor).toBe(543n);
    expect(inv.cgstMinor + inv.sgstMinor).toBe(543n);
    expect(inv.taxableMinor + inv.taxMinor).toBe(inv.totalMinor);
  });
  it("an invoice needs at least one line", () => {
    expect(codeOf(() => computeInvoice([], { gstRegistered: true, supplierGstin: SUPPLIER, placeOfSupply: "29", customerGstin: null }))).toBe("INVOICE_NO_LINES");
  });
});

describe("credit / debit notes (s.34)", () => {
  it("the s.34 limit is 30 November after the end of the invoice's financial year", () => {
    expect(s34Cutoff("2026-11-10")).toBe("2027-11-30");
    expect(s34Cutoff("2027-03-31")).toBe("2027-11-30");
    expect(s34Cutoff("2026-04-01")).toBe("2027-11-30");
    expect(withinS34("2026-11-10", "2027-11-30")).toBe(true);
    expect(withinS34("2026-11-10", "2027-12-01")).toBe(false);
  });
  it("a note takes the invoice's supply type for its heads", () => {
    const n = computeNote(100000n, 18, "inter", SUPPLIER, "27", BUYER_MH);
    expect(n).toMatchObject({ supplyType: "inter", igstMinor: 18000n, totalMinor: 118000n });
    expect(computeNote(100000n, 18, "intra", SUPPLIER, "29", BUYER_KA)).toMatchObject({ cgstMinor: 9000n, sgstMinor: 9000n });
    expect(computeNote(100000n, 0, "none", null, "29", null)).toMatchObject({ supplyType: "none", taxMinor: 0n });
    expect(codeOf(() => computeNote(0n, 18, "intra", SUPPLIER, "29", null))).toBe("NOTE_AMOUNT");
  });
});

describe("AR ageing buckets", () => {
  it("buckets by days past the due date", () => {
    const asOf = "2026-11-18";
    expect(ageingBucket("2026-11-18", asOf)).toBe("not_due");
    expect(ageingBucket("2026-12-01", asOf)).toBe("not_due");
    expect(ageingBucket("2026-11-17", asOf)).toBe("d1_30");
    expect(ageingBucket("2026-10-19", asOf)).toBe("d1_30");
    expect(ageingBucket("2026-10-18", asOf)).toBe("d31_60");
    expect(ageingBucket("2026-09-19", asOf)).toBe("d31_60");
    expect(ageingBucket("2026-09-18", asOf)).toBe("d61_90");
    expect(ageingBucket("2026-08-19", asOf)).toBe("d90_plus");
  });
});

describe("Rule 46 numbering", () => {
  it("INV/2627/000001 is within 16 characters of [A-Z0-9/-] and the FY segment follows the document date", () => {
    const at = mintInstant("2026-11-10");
    expect(fySegment(at)).toBe("2627");
    expect(fySegment(mintInstant("2027-03-31"))).toBe("2627");
    expect(fySegment(mintInstant("2027-04-01"))).toBe("2728");
    const no = formatReference(specFor("sales_invoice"), 1n, { at, segments: [fySegment(at)] });
    expect(no).toBe("INV/2627/000001");
    expect(no.length).toBeLessThanOrEqual(16);
    assertRule46(no);
    expect(formatReference(specFor("credit_note"), 12n, { at, segments: [fySegment(at)] })).toBe("CN/2627/000012");
    expect(codeOf(() => assertRule46("INVOICE/2026-27/0000001"))).toBe("DOC_NO_RULE46");
  });
});

describe("invoice document", () => {
  const model: InvoiceDocModel = {
    kind: "invoice", docNo: "INV/2627/000001", docDate: "2026-11-10", dueDate: "2026-12-10", supplierGstin: SUPPLIER, customerName: "Acme Traders", customerGstin: BUYER_KA,
    placeOfSupply: "29", placeOfSupplyName: "Karnataka", supplyType: "intra", reverseCharge: false, refInvoiceNo: null,
    lines: [{ description: "Registers", hsnSac: "4820", qty: "3.000", rateMinor: 100000n, taxableMinor: 300000n, gstRatePct: "18.00", taxMinor: 54000n, totalMinor: 354000n }],
    taxableMinor: 300000n, cgstMinor: 27000n, sgstMinor: 27000n, igstMinor: 0n, totalMinor: 354000n, narration: null,
  };
  it("a registered supplier issues a Tax Invoice; an unregistered one an Invoice; notes are titled as such", () => {
    expect(titleFor(model)).toBe("Tax Invoice");
    expect(titleFor({ ...model, supplierGstin: null })).toBe("Invoice");
    expect(titleFor({ ...model, kind: "credit_note" })).toBe("Credit Note");
  });
  it("prints the Rule 46 particulars and the STORED split", async () => {
    const html = (await buildInvoiceDoc(model, { ...EMPTY_DOC_IDENTITY, orgName: "Acme Supplies Pvt Ltd" })).toHtml();
    for (const needle of ["INV/2627/000001", "Tax Invoice", SUPPLIER, BUYER_KA, "4820", "CGST", "SGST", "Karnataka"]) expect(html).toContain(needle);
    expect(html).not.toContain("IGST");
  });
});
