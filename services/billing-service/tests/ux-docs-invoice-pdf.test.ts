/** UAT ux-docs: the billing invoice embeds the document font and carries GSTINs, HSN/SAC, the tax split and words. */
import { describe, it, expect } from "vitest";
import { pdfFlatText, pdfFonts, isPdf } from "@civitasone/render/testing";
import { EMPTY_DOC_IDENTITY } from "@civitasone/render/official";
import { renderInvoicePdf, type InvoicePdfModel } from "../src/modules/invoices/pdf.js";

const AT = new Date("2026-11-04T07:00:00.000Z");
const base: InvoicePdfModel = {
  invoiceNumber: "INV-2627-000012", periodMonth: "2026-09", status: "issued", issuedAt: "2026-09-05T00:00:00.000Z",
  supplierGstin: "07AAACN1234A1Z5", recipientGstin: "07AABCD5678B1Z2", placeOfSupply: "07",
  taxMinor: "45000", cgstMinor: "22500", sgstMinor: "22500", igstMinor: "0", totalMinor: "295000", paidMinor: "0", outstandingMinor: "295000",
  items: [
    { description: "Platform subscription", kind: "line", quantity: "1", amountMinor: "250000", hsnSac: "998313" },
    { description: "GST 18%", kind: "tax", quantity: "1", amountMinor: "45000", hsnSac: null },
  ],
};

describe("invoice PDF", () => {
  it("tax invoice: both GSTINs, HSN/SAC, CGST/SGST, rupee amounts and the amount in words", async () => {
    const bytes = await renderInvoicePdf(base, { supplier: { name: "CivitasOne Platform Services", address: "Bengaluru" }, recipient: { ...EMPTY_DOC_IDENTITY, orgName: "UAT Department", address: "New Delhi" } }, AT);
    expect(isPdf(bytes)).toBe(true);
    const flat = await pdfFlatText(bytes);
    for (const s of ["TAX INVOICE", "Invoice No. INV-2627-000012", "Dated: 05 Sep 2026", "Supplier GSTIN 07AAACN1234A1Z5", "Recipient GSTIN 07AABCD5678B1Z2",
      "Place of supply 07 (Delhi)", "Bill to UAT Department, New Delhi", "Platform subscription 998313 1 2,500.00", "CGST 225.00", "SGST / UTGST 225.00",
      "Invoice total 2,950.00", "Rupees Two Thousand Nine Hundred Fifty Only", "CivitasOne Platform Services"]) {
      expect(flat).toContain(s);
    }
    expect(flat).not.toContain("GST 18% (tax)");
    expect(flat).not.toContain("INR ");
  });

  it("an unregistered supplier issues a bill of supply, never a blank GSTIN", async () => {
    const flat = await pdfFlatText(await renderInvoicePdf({ ...base, supplierGstin: null, recipientGstin: null, placeOfSupply: null }, {}, AT));
    expect(flat).toContain("BILL OF SUPPLY");
    expect(flat).toContain("Supplier GSTIN Not registered under GST");
    expect(flat).toContain("Recipient GSTIN Unregistered recipient");
    expect(flat).not.toMatch(/GSTIN -( |$)/);
  });

  it("embeds Noto Sans Devanagari, not WinAnsi Helvetica", async () => {
    const fonts = await pdfFonts(await renderInvoicePdf(base, {}, AT));
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.some((f) => /Helvetica/.test(f.baseFont))).toBe(false);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });
});
