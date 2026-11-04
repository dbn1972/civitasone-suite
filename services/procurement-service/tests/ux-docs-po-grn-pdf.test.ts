/**
 * UAT ux-docs: the PO and GRN prints are real PDFs.
 *
 * Golden test for the "No line items" defect: the print route used to read `po.items`
 * (qty / amountMinor) while getPo() returns the lines as `lineItems` (quantity /
 * unitPriceMinor), so every PO printed "No line items". poDocModel() is fed exactly the
 * shape getPo() returns and must carry every line through to the PDF.
 */
import { describe, it, expect, afterAll } from "vitest";
import { closePdfRenderer } from "@civitasone/render";
import { createPoBody, gstAllowedRatesBp, DEFAULT_GST_ALLOWED_RATES_BP } from "../src/modules/po/validators.js";
import { pdfText, pdfFlatText, pdfFonts, isPdf } from "@civitasone/render/testing";
import { EMPTY_DOC_IDENTITY, type DocIdentity } from "@civitasone/render/official";
import { poDocModel, poTotals, renderPoPdf, renderGrnPdf } from "../src/modules/po-print/po-document.js";

const AT = new Date("2026-11-04T07:00:00.000Z");
afterAll(async () => { await closePdfRenderer(); });
const BUYER: DocIdentity = { ...EMPTY_DOC_IDENTITY, orgName: "Digital India Corporation", ministry: "Ministry of Electronics and Information Technology", address: "Electronics Niketan, New Delhi", gstin: "07AAACD1234F1Z5", stateCode: "07" };

/** Exactly what getPo() (po/queries.ts) returns for PO/2026/0035 (one line, 4 x 1,500.50). */
function getPoShape(over: Record<string, unknown> = {}, line: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-2222-4000-8000-000000000035", tenantId: "t", poNo: "PO/2026/0035", vendorId: "v1", indentRef: "IND/2026/0012",
    sanctionRef: "W7-SAN-51E93C05", orderType: "supply", totalMinor: "600200", status: "approved", createdBy: "u1",
    vendor: "Acme Supplies", vendorName: "Acme Supplies", orderDate: "2026-11-04", deliveryDate: "2026-11-30", totalAmount: 600200,
    lineItems: [{
      id: "33333333-4444-4000-8000-000000000001", itemCode: "IT-001", itemName: "Desktop computer", description: "Desktop computer",
      quantity: 4, unit: "nos", unitPriceMinor: 150050, unitPrice: 150050, totalPrice: 600200, grnQty: 0, gstRateBp: null, hsnSac: null, ...line,
    }],
    ...over,
  };
}

describe("PO line items (golden)", () => {
  it("maps getPo().lineItems - the field the old route never read", () => {
    expect(poDocModel(getPoShape(), { gstin: "07BBBBB1111B1Z5", address: "Okhla, New Delhi" })).toEqual({
      poNo: "PO/2026/0035", orderDate: "2026-11-04", deliveryDate: "2026-11-30", status: "approved", orderType: "supply",
      indentRef: "IND/2026/0012", sanctionRef: "W7-SAN-51E93C05", gemRef: null, recordedTotalMinor: 600200n,
      vendor: { name: "Acme Supplies", gstin: "07BBBBB1111B1Z5", address: "Okhla, New Delhi" },
      lines: [{ itemCode: "IT-001", description: "Desktop computer", quantity: 4, unit: "nos", unitPriceMinor: 150050n, gstRateBp: null, hsnSac: null }],
    });
  });

  it("prints the line (never \"No line items\") with Indian grouping and the amount in words", async () => {
    const bytes = await renderPoPdf(poDocModel(getPoShape(), { gstin: "07BBBBB1111B1Z5" }), BUYER, { name: "Asha Rao", designation: "Under Secretary" }, AT);
    expect(isPdf(bytes)).toBe(true);
    const text = await pdfText(bytes);
    const flat = await pdfFlatText(bytes);
    expect(text).not.toMatch(/No line items/i);
    expect(text).toContain("No. PO/2026/0035");
    expect(text).toContain("Dated: 04 Nov 2026");
    expect(flat).toContain("1 Desktop computer (IT-001)");
    expect(flat).toContain("4 nos 1,500.50 6,002.00");
    expect(flat).toContain("Rupees Six Thousand Two Only");
    expect(flat).toContain("GST rate not recorded for line 1");
    expect(flat).toContain("Terms and conditions");
    expect(flat).toContain("(Asha Rao)");
  });

  it("intra-State supply: CGST + SGST at half the rate each, HSN printed", async () => {
    const m = poDocModel(getPoShape({}, { gstRateBp: 1800, hsnSac: "84713010" }), { gstin: "07BBBBB1111B1Z5" });
    const t = poTotals(m, BUYER);
    expect(t).toMatchObject({ kind: "intra", taxableMinor: 600200n, cgstMinor: 54018n, sgstMinor: 54018n, igstMinor: 0n, grandMinor: 708236n });
    const flat = await pdfFlatText(await renderPoPdf(m, BUYER, null, AT));
    expect(flat).toContain("84713010");
    expect(flat).toContain("CGST 540.18");
    expect(flat).toContain("SGST / UTGST 540.18");
    expect(flat).toContain("Total order value including GST 7,082.36");
    expect(flat).toContain("Rupees Seven Thousand Eighty Two and Thirty Six Paise Only");
    expect(flat).toContain("Supplier GSTIN 07BBBBB1111B1Z5");
    expect(flat).toContain("Buyer GSTIN 07AAACD1234F1Z5");
  });

  it("inter-State supply: IGST", () => {
    const m = poDocModel(getPoShape({}, { gstRateBp: 1800 }), { gstin: "29BBBBB1111B1Z5" });
    expect(poTotals(m, BUYER)).toMatchObject({ kind: "inter", igstMinor: 108036n, cgstMinor: 0n });
  });

  it("unregistered supplier: no GST is added, even on a rated line (review)", async () => {
    const m = poDocModel(getPoShape({}, { gstRateBp: 1800 }), { gstin: null });
    expect(poTotals(m, BUYER)).toMatchObject({ kind: "unregistered", taxMinor: 0n, cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, grandMinor: 600200n });
    const flat = await pdfFlatText(await renderPoPdf(m, BUYER, null, AT));
    expect(flat).toContain("Supplier GSTIN Not registered under GST");
    expect(flat).toContain("The supplier is not registered under GST: no GST is charged on this order.");
    expect(flat).toContain("Total order value 6,002.00");
    // no tax rows (the general terms still explain CGST/SGST/IGST in words)
    expect(flat).not.toMatch(/CGST [0-9]/);
    expect(flat).not.toMatch(/SGST \/ UTGST [0-9]/);
    expect(flat).not.toMatch(/IGST [0-9]/);
    expect(flat).not.toContain("including GST");
    expect(flat).toContain("Rupees Six Thousand Two Only");
  });

  it("GST slabs: 0.1 / 0.25 / 1.5 / 3 / 5 / 12 / 18 / 28 / 40 % accepted, others refused; the list is configurable", () => {
    const line = { itemCode: "V-1", description: "Large vehicle", quantity: 1, unitPriceMinor: 100, gstRateBp: 4000 };
    const body = (gstRateBp: number) => ({ vendorId: "9c900000-3333-4000-8000-0000000d0c99", indentRef: "IND/1", items: [{ ...line, gstRateBp }] });
    for (const bp of [0, 10, 25, 150, 300, 500, 1200, 1800, 2800, 4000]) expect(createPoBody.safeParse(body(bp)).success).toBe(true);
    for (const bp of [700, 2900, 4100, -100]) expect(createPoBody.safeParse(body(bp)).success).toBe(false);
    expect(gstAllowedRatesBp(undefined)).toEqual(DEFAULT_GST_ALLOWED_RATES_BP);
    expect(gstAllowedRatesBp("5, 18, 40")).toEqual([500, 1800, 4000]);
    const flat40 = poTotals(poDocModel(getPoShape({}, { gstRateBp: 4000 }), { gstin: "29BBBBB1111B1Z5" }), BUYER);
    expect(flat40).toMatchObject({ kind: "inter", igstMinor: 240080n });
  });

  it("a PO with several lines prints every one of them", async () => {
    const po = getPoShape({ totalMinor: "1100000", lineItems: [
      { id: "a", itemCode: "A-1", description: "Chair", quantity: 10, unit: "nos", unitPriceMinor: 50000 },
      { id: "b", itemCode: "B-2", description: "Table", quantity: 2, unit: "nos", unitPriceMinor: 300000 },
    ] });
    const flat = await pdfFlatText(await renderPoPdf(poDocModel(po, null), BUYER, null, AT));
    expect(flat).toContain("1 Chair (A-1)");
    expect(flat).toContain("2 Table (B-2)");
    expect(flat).toContain("Total order value 11,000.00");
  });

  it("embeds Noto Sans Devanagari", async () => {
    const fonts = await pdfFonts(await renderPoPdf(poDocModel(getPoShape(), null), BUYER, null, AT));
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });
});

describe("GRN PDF", () => {
  it("prints the PO reference number, item names and both signatories - no internal ids", async () => {
    const bytes = await renderGrnPdf({
      grnNo: "GRN/2026/0022", receivedDate: "2026-11-04", status: "accepted", poNo: "PO/2026/0035", vendor: "Acme Supplies", notes: null,
      items: [{ itemCode: "IT-001", description: "Desktop computer", orderedQty: 4, receivedQty: 4, acceptedQty: 3, unit: "nos" }],
      inspection: { result: "passed", date: "2026-11-05", remarks: "One unit damaged" },
    }, BUYER, { name: "Store Keeper One", designation: "Store Officer" }, { name: "Inspector Two", designation: "Assistant Engineer" }, AT);
    const flat = await pdfFlatText(bytes);
    expect(flat).toContain("No. GRN/2026/0022");
    expect(flat).toContain("PO No. PO/2026/0035");
    expect(flat).toContain("Desktop computer (IT-001) 4 nos 4 nos 3 nos 1 nos");
    expect(flat).toContain("(Store Keeper One)");
    expect(flat).toContain("(Inspector Two)");
    expect(flat).not.toMatch(/procurement_po:|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
