import { describe, it, expect } from "vitest";
import { balanceTotals, entryHref, hasNoRows, linkState } from "./linkHelpers";

describe("linkState", () => {
  it("is linked / unlinked from a known set, and never guesses when the links could not be loaded", () => {
    const set = new Set(["a"]);
    expect(linkState("a", set)).toBe("linked");
    expect(linkState("b", set)).toBe("unlinked");
    expect(linkState("a", null)).toBe("unknown");
    expect(linkState("b", null)).toBe("unknown");
  });
});

describe("entryHref", () => {
  it("opens the item master page for any item that has an inventory side, the stock page otherwise", () => {
    expect(entryHref({ inventoryItemId: "i1", stockItemId: "s1" })).toBe("/inventory/items/i1");
    expect(entryHref({ inventoryItemId: "i1", stockItemId: null })).toBe("/inventory/items/i1");
    expect(entryHref({ inventoryItemId: null, stockItemId: "s9" })).toBe("/inventory/s9");
  });
});

describe("balanceTotals / hasNoRows", () => {
  it("parses the minor-unit total, and is null for missing or garbled balances", () => {
    expect(balanceTotals({ itemId: "s", totalQty: 15, totalValueMinor: "8000", warehouses: [] })).toEqual({ qty: 15, valueMinor: 8000n });
    expect(balanceTotals(null)).toBeNull();
    expect(balanceTotals({ itemId: "s", totalQty: 1, totalValueMinor: "x", warehouses: [] })).toBeNull();
  });
  it("hasNoRows", () => {
    expect(hasNoRows([])).toBe(true);
    expect(hasNoRows([1])).toBe(false);
  });
});
