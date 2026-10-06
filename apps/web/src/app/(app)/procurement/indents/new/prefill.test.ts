import { describe, it, expect } from "vitest";
import { parseIndentPrefill } from "./prefill";

describe("GAP-INVENTORY-LOW-STOCK-03: indent prefill from the low-stock link", () => {
  it("builds the first line item from item code, description and quantity", () => {
    expect(parseIndentPrefill({ itemCode: "PEN-01", description: "Gel pen", quantity: "40" })).toEqual({
      item: { itemCode: "PEN-01", description: "Gel pen", quantity: 40, unitPrice: 0, unit: "nos" },
      truncated: false,
    });
  });

  it("returns null when the link carries no item", () => {
    expect(parseIndentPrefill({})).toBeNull();
    expect(parseIndentPrefill({ quantity: "5" })).toBeNull();
  });

  it("falls back to quantity 1 for non-positive, fractional or absurd quantities", () => {
    for (const quantity of ["0", "-3", "2.5", "abc", "99999999", ""]) {
      expect(parseIndentPrefill({ itemCode: "A", quantity })?.item.quantity).toBe(1);
    }
  });

  it("caps over-long values", () => {
    const r = parseIndentPrefill({ itemCode: "x".repeat(500), description: "y".repeat(500) });
    expect(r?.item.itemCode).toHaveLength(64);
    expect(r?.item.description).toHaveLength(200);
  });

  it("flags truncation so the form can tell the requester", () => {
    expect(parseIndentPrefill({ itemCode: "A", description: "y".repeat(201) })?.truncated).toBe(true);
    expect(parseIndentPrefill({ itemCode: "x".repeat(65) })?.truncated).toBe(true);
    expect(parseIndentPrefill({ itemCode: "A", description: "y".repeat(200) })?.truncated).toBe(false);
  });
});
