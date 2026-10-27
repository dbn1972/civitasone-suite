/**
 * GAP-STOCK-LIST-04: the item list maps the service's stock figures (currentStock, unitCost and
 * totalValue as paise strings) to numbers and derives the stock status from them.
 */
import { describe, it, expect } from "vitest";
import { mapStockItemSummaries } from "./apiMappers";

const base = { id: crypto.randomUUID(), name: "A4 Paper", code: "PAP-A4", categoryName: "Stationery", uomCode: "rm", reorderLevel: 4 };

describe("mapStockItemSummaries with the stock-service stock figures", () => {
  it("maps stock and paise-string money", () => {
    const [it0] = mapStockItemSummaries({ data: [{ ...base, currentStock: 5, unitCost: "1430", totalValue: "7150" }] })!;
    expect(it0).toMatchObject({ currentStock: 5, unitCost: 1430, totalValue: 7150, minStockLevel: 4, stockStatus: "ok" });
  });

  it("reports out-of-stock for an item with zero stock and value", () => {
    const [it0] = mapStockItemSummaries({ data: [{ ...base, reorderLevel: 0, currentStock: 0, unitCost: null, totalValue: "0" }] })!;
    expect(it0).toMatchObject({ stockStatus: "out", totalValue: 0, unitCost: null });
  });

  it("leaves the value unknown (null) when the service sends none", () => {
    const [it0] = mapStockItemSummaries({ data: [{ ...base }] })!;
    expect(it0!.totalValue).toBeNull();
  });
});
