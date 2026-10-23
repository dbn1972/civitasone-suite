import { describe, it, expect } from "vitest";
import { billPoLabel, billPoHref } from "./billRefs";

const PO_UUID = "5b1c2d3e-0000-4000-8000-000000000000";

// GAP-FINANCE-EXPENDITURE-BILLS-06
describe("billPoLabel", () => {
  it("shows the human PO number when the bill carries one", () => {
    expect(billPoLabel({ poRef: "procurement_po:abc-123", poNumber: "PO-2026-014" })).toBe("PO-2026-014");
    expect(billPoLabel({ poRef: `procurement_po:${PO_UUID}`, poNumber: "  PO-2026-014 " })).toBe("PO-2026-014");
  });

  it("falls back to the short readable ref when there is no number", () => {
    expect(billPoLabel({ poRef: `procurement_po:${PO_UUID}` })).toBe("PO 5b1c2d3e");
    expect(billPoLabel({ poRef: `procurement_po:${PO_UUID}`, poNumber: null })).toBe("PO 5b1c2d3e");
    expect(billPoLabel({ poRef: `procurement_po:${PO_UUID}`, poNumber: "   " })).toBe("PO 5b1c2d3e");
  });

  it("never prints a stringified missing value as a PO number", () => {
    expect(billPoLabel({ poRef: `procurement_po:${PO_UUID}`, poNumber: "undefined" })).toBe("PO 5b1c2d3e");
    expect(billPoLabel({ poRef: `procurement_po:${PO_UUID}`, poNumber: "null" })).toBe("PO 5b1c2d3e");
  });

  it("renders an em dash when the bill has no PO reference", () => {
    expect(billPoLabel({ poRef: null })).toBe("—");
    expect(billPoLabel({})).toBe("—");
    expect(billPoLabel({ poRef: "procurement_po:undefined" })).toBe("—");
  });
});

describe("billPoHref", () => {
  it("links a PO ref with a UUID id to the purchase order", () => {
    expect(billPoHref({ poRef: `procurement_po:${PO_UUID}`, poNumber: "PO-2026-014" })).toBe(`/procurement/orders/${PO_UUID}`);
  });

  it("gives no link when the ref is absent or names no page", () => {
    expect(billPoHref({ poRef: null })).toBeNull();
    expect(billPoHref({ poRef: "procurement_po:abc-123", poNumber: "PO-2026-014" })).toBeNull();
    expect(billPoHref({ poRef: "procurement_grn:5b1c2d3e" })).toBeNull();
  });
});
