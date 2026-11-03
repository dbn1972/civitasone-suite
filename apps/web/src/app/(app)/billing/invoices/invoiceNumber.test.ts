import { describe, it, expect } from "vitest";
import { invoiceDisplayNumber, DRAFT_INVOICE_LABEL } from "./invoiceNumber";

describe("invoiceDisplayNumber (UAT Phase 1B recon D18)", () => {
  it("shows the stored GST invoice number", () => {
    expect(invoiceDisplayNumber({ invoiceNumber: "INV-2627-000009" })).toBe("INV-2627-000009");
  });
  it("a draft (null / missing number) reads as not numbered, never a synthesised id", () => {
    expect(invoiceDisplayNumber({ invoiceNumber: null })).toBe(DRAFT_INVOICE_LABEL);
    expect(invoiceDisplayNumber({})).toBe(DRAFT_INVOICE_LABEL);
    expect(invoiceDisplayNumber({ invoiceNumber: "  " })).toBe(DRAFT_INVOICE_LABEL);
  });
});
