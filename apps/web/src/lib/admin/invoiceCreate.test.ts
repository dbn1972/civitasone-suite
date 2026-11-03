import { describe, it, expect } from "vitest";
import { buildInvoiceBody, emptyGst, emptyItem, invoiceTotals, validateInvoiceForm, type InvoiceForm } from "./invoiceCreate";

const form = (over: Partial<InvoiceForm> = {}): InvoiceForm => ({
  periodMonth: "2026-11",
  items: [{ ...emptyItem(), description: "Platform fee", amount: "2000", quantity: "1" }],
  gstEnabled: false,
  gst: emptyGst(),
  ...over,
});
const TAX = { ...emptyItem(), description: "GST 18%", kind: "tax" as const, amount: "360" };

describe("UAT P2 J8: new invoice rules", () => {
  it("a valid draft has no errors and builds the billing-service body in integer paise", () => {
    const f = form({ items: [{ ...emptyItem(), description: " Platform fee ", amount: "2000.50", quantity: "2", hsnSac: "998314" }] });
    expect(validateInvoiceForm(f)).toEqual({});
    expect(buildInvoiceBody("t-1", f)).toEqual({
      tenantId: "t-1", periodMonth: "2026-11",
      items: [{ description: "Platform fee", kind: "line", quantity: 2, amountMinor: 200050, hsnSac: "998314" }],
    });
    expect(invoiceTotals(f.items).totalMinor).toBe(400100n);
  });

  it("refuses a bad period, blank description, bad quantity, bad amount and bad HSN", () => {
    const e = validateInvoiceForm(form({ periodMonth: "2026-13", items: [{ description: " ", kind: "line", hsnSac: "12", quantity: "0", amount: "1.005" }] }));
    expect(e).toMatchObject({
      periodMonth: "periodInvalid", "items.0.description": "descriptionRequired", "items.0.quantity": "quantityInvalid",
      "items.0.amount": "amountInvalid", "items.0.hsnSac": "hsnInvalid",
    });
  });

  it("a zero total or no items is refused", () => {
    expect(validateInvoiceForm(form({ items: [{ ...emptyItem(), description: "x", amount: "0" }] })).items).toBe("totalZero");
    expect(validateInvoiceForm(form({ items: [] })).items).toBe("itemsRequired");
  });

  it("GST: the split must match the tax lines and the intra/inter-state rule (mirrors validateGstSplit)", () => {
    const base = { supplierGstin: "29ABCDE1234F1Z5", recipientGstin: "29PQRSX6789K1Z3", placeOfSupply: "29", cgst: "180", sgst: "180", igst: "0" };
    const items = [form().items[0]!, TAX];
    expect(validateInvoiceForm(form({ items, gstEnabled: true, gst: base }))).toEqual({});
    expect(validateInvoiceForm(form({ items, gstEnabled: true, gst: { ...base, cgst: "100" } })).gst).toBe("gstSumMismatch");
    expect(validateInvoiceForm(form({ items, gstEnabled: true, gst: { ...base, cgst: "0", sgst: "0", igst: "360" } })).gst).toBe("gstIntraIgst");
    expect(validateInvoiceForm(form({ items, gstEnabled: true, gst: { ...base, placeOfSupply: "07" } })).gst).toBe("gstInterOnlyIgst");
    expect(validateInvoiceForm(form({ items, gstEnabled: true, gst: { ...base, supplierGstin: "bad" } }))["gst.supplierGstin"]).toBe("gstinInvalid");
    const body = buildInvoiceBody("t", form({ items, gstEnabled: true, gst: base }));
    expect(body.gst).toEqual({ supplierGstin: "29ABCDE1234F1Z5", recipientGstin: "29PQRSX6789K1Z3", placeOfSupply: "29", cgstMinor: 18000, sgstMinor: 18000, igstMinor: 0 });
  });
});
