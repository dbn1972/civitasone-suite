import { describe, it, expect } from "vitest";
import { formatConversionFactor, isActiveReservation, lowStockSeverity, raiseIndentHref } from "./_labels";

describe("GAP-INVENTORY-LOW-STOCK-03: severity from on-hand vs reorder level", () => {
  it("0 on hand is Out of stock", () => {
    expect(lowStockSeverity(0, 10)).toEqual({ label: "Out of stock", variant: "bad" });
  });
  it("at or below half the level is Critical", () => {
    expect(lowStockSeverity(5, 10).label).toBe("Critical");
    expect(lowStockSeverity(2, 10).label).toBe("Critical");
  });
  it("80% of the level is merely Low", () => {
    expect(lowStockSeverity(8, 10)).toEqual({ label: "Low", variant: "warn" });
  });
});

describe("GAP-INVENTORY-LOW-STOCK-03: Raise indent link", () => {
  it("prefills SKU, item name and the suggested quantity", () => {
    const href = raiseIndentHref({ sku: "PEN-01", name: "Gel pen", suggestedReorderQty: 40 });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/procurement/indents/new");
    expect(url.searchParams.get("itemCode")).toBe("PEN-01");
    expect(url.searchParams.get("description")).toBe("Gel pen");
    expect(url.searchParams.get("quantity")).toBe("40");
  });
  it("omits the SKU when absent and the quantity when not a positive whole number", () => {
    const url = new URL(raiseIndentHref({ sku: null, name: "A & B", suggestedReorderQty: 0 }), "http://x");
    expect(url.searchParams.has("itemCode")).toBe(false);
    expect(url.searchParams.has("quantity")).toBe(false);
    expect(url.searchParams.get("description")).toBe("A & B");
  });
});

describe("GAP-INVENTORY-RESERVATIONS-02: isActiveReservation", () => {
  it("only active holds count", () => {
    expect(isActiveReservation({ status: "active" })).toBe(true);
    for (const status of ["released", "expired", "consumed", ""]) expect(isActiveReservation({ status })).toBe(false);
  });
});

describe("GAP-INVENTORY-SUBSTITUTES-03: formatConversionFactor", () => {
  it("1.500000 reads 1 : 1.5", () => expect(formatConversionFactor("1.500000")).toBe("1 : 1.5"));
  it("whole numbers drop the decimals", () => expect(formatConversionFactor("2.000000")).toBe("1 : 2"));
  it("non-numeric and empty values are shown raw, never NaN", () => {
    expect(formatConversionFactor("abc")).toBe("abc");
    expect(formatConversionFactor("")).toBe("");
  });
});
