/** UAT ux-docs: the billing invoice embeds the document font and carries GSTINs, HSN/SAC, the tax split and words. */
import { describe, it, expect, afterAll } from "vitest";
import { closePdfRenderer } from "@civitasone/render";
import { pdfFlatText, pdfFonts, isPdf } from "@civitasone/render/testing";
import { EMPTY_DOC_IDENTITY } from "@civitasone/render/official";
import { renderInvoicePdf, InvoiceSupplierNotConfiguredError, taxRateLabel, type InvoicePdfModel } from "../src/modules/invoices/pdf.js";
afterAll(async () => { await closePdfRenderer(); });
const SUPPLIER = { name: "CivitasOne Platform Services", address: "Bengaluru", signatory: "K. Menon" };

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
    const bytes = await renderInvoicePdf(base, { supplier: SUPPLIER, recipient: { ...EMPTY_DOC_IDENTITY, orgName: "UAT Department", address: "New Delhi" } }, AT);
    expect(isPdf(bytes)).toBe(true);
    const flat = await pdfFlatText(bytes);
    for (const s of ["TAX INVOICE", "Invoice No. INV-2627-000012", "Dated: 05 Sep 2026", "Supplier GSTIN 07AAACN1234A1Z5", "Recipient GSTIN 07AABCD5678B1Z2",
      "Place of supply 07 (Delhi)", "Bill to UAT Department, New Delhi", "Platform subscription 998313 1 2,500.00", 
      "Invoice total 2,950.00", "Rupees Two Thousand Nine Hundred Fifty Only", "CivitasOne Platform Services",
      "CGST 9% 225.00", "SGST / UTGST 9% 225.00", "Whether tax is payable on reverse charge: No", "For CivitasOne Platform Services", "Authorised Signatory"]) {
      expect(flat).toContain(s);
    }
    expect(flat).not.toContain("GST 18% (tax)");
    expect(flat).not.toContain("INR ");
  });

  it("an unregistered supplier issues a bill of supply: no GSTIN blanks, no tax heads (review)", async () => {
    const flat = await pdfFlatText(await renderInvoicePdf({ ...base, supplierGstin: null, recipientGstin: null, placeOfSupply: null }, { supplier: SUPPLIER }, AT));
    expect(flat).toContain("BILL OF SUPPLY");
    expect(flat).toContain("Supplier GSTIN Not registered under GST");
    expect(flat).toContain("Recipient GSTIN Unregistered recipient");
    expect(flat).not.toMatch(/GSTIN -( |$)/);
    expect(flat).not.toContain("CGST");
    expect(flat).not.toContain("SGST");
    expect(flat).not.toContain("IGST");
    // B22 D2/D3: a bill that predates the issue-time rule (tax recorded, no supplier GSTIN) prints as RECORDED: the
    // stored total (2,950.00) with the tax shown as a recorded amount, never a re-summed 2,500.00 that disagrees with
    // the record and what was paid. New bills of this shape are refused at issue (see b22-invoice-pdf-gst-paid.test.ts).
    expect(flat).toContain("Value of supply 2,500.00");
    expect(flat).toContain("Tax as recorded");
    expect(flat).toContain("Total 2,950.00");
    expect(flat).toContain("Rupees Two Thousand Nine Hundred Fifty Only");
    expect(flat).not.toContain("reverse charge");
  });

  it("refuses without a supplier name (Rule 46(a)); rate label per head", async () => {
    await expect(renderInvoicePdf(base, { supplier: { name: null, address: null } }, AT)).rejects.toBeInstanceOf(InvoiceSupplierNotConfiguredError);
    expect(taxRateLabel(22_500n, 250_000n)).toBe("9%");
    expect(taxRateLabel(45_000n, 250_000n)).toBe("18%");
    expect(taxRateLabel(250n, 100_000n)).toBe("0.25%");
    expect(taxRateLabel(0n, 100_000n)).toBe("");
  });

  it("embeds Noto Sans Devanagari, not WinAnsi Helvetica", async () => {
    const fonts = await pdfFonts(await renderInvoicePdf(base, { supplier: SUPPLIER }, AT));
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.some((f) => /Helvetica/.test(f.baseFont))).toBe(false);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });
});
