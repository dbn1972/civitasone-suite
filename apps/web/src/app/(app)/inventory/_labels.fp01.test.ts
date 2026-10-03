import { describe, it, expect } from "vitest";
import { userRefLabel, receiptDocLabels } from "./_labels";

describe("userRefLabel (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-03 / GOODS-RETURNS-DETAIL-05)", () => {
  it("prefers the resolved name", () => {
    expect(userRefLabel("u-1234567890", "  Vikram Sethi ")).toBe("Vikram Sethi");
  });
  it("falls back to the id prefix, then to a dash", () => {
    expect(userRefLabel("u-1234567890")).toBe("User u-123456");
    expect(userRefLabel("u-1234567890", "   ")).toBe("User u-123456");
    expect(userRefLabel(null, null)).toBe("—");
  });
});

describe("receiptDocLabels (GAP-INVENTORY-RECEIPTS-03)", () => {
  it("uses the GRN number and PO reference when present", () => {
    expect(receiptDocLabels({ grnNo: "GRN-7", poRef: "PO-9", refNo: "11111111-2222-4333-8444-555555555555" })).toEqual({ grn: "GRN-7", po: "PO-9" });
  });
  it("never shows a bare uuid refNo as a document number", () => {
    expect(receiptDocLabels({ refDoc: "GRN", refNo: "11111111-2222-4333-8444-555555555555" })).toEqual({ grn: null, po: null });
  });
  it("shows a human refNo (manual receipt) as the document", () => {
    expect(receiptDocLabels({ refDoc: "Challan", refNo: "CH-0042" })).toEqual({ grn: "CH-0042", po: null });
  });
});
