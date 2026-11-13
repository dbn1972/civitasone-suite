import { describe, it, expect } from "vitest";
import { mapLedgerSource, registerRowsFromInventory } from "./_dataLedger";
import { mapStockItemSummaries } from "@/app/_data/apiMappers";

describe("mapLedgerSource", () => {
  it("is 'inventory' only when the service says so", () => {
    expect(mapLedgerSource({ data: { ledgerSource: "inventory" } })).toBe("inventory");
    expect(mapLedgerSource({ data: { ledgerSource: "stock" } })).toBe("stock");
    expect(mapLedgerSource({ data: { qcMakerChecker: true } })).toBe("stock"); // an older service
    expect(mapLedgerSource({ data: { ledgerSource: "something-else" } })).toBe("stock");
    expect(mapLedgerSource({})).toBeNull();
    expect(mapLedgerSource(null)).toBeNull();
  });
});

describe("registerRowsFromInventory", () => {
  const item = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: `Item ${id}`, sku: `SKU-${id}`, status: "active", category: "Stationery", uom: "EA",
    itemType: "consumable", reorderLevel: 0, reorderQty: 0, unitCostMinor: "0", ...over,
  });
  it("sums each item over every store and values it", () => {
    const rows = registerRowsFromInventory(
      [item("a", { reorderLevel: 10 }), item("b"), item("c", { sku: null, category: null, uom: null })] as never,
      [
        { itemId: "a", storeId: "s1", onHandQty: 6, valueMinor: "6000" },
        { itemId: "a", storeId: "s2", onHandQty: 2, valueMinor: "2400" },
        { itemId: "b", storeId: "s1", onHandQty: 50, valueMinor: "100000" },
      ],
    );
    expect(rows[0]).toMatchObject({ id: "a", itemCode: "SKU-a", currentStock: 8, totalValue: 8400, isLowStock: true, stockStatus: "low" });
    expect(rows[1]).toMatchObject({ currentStock: 50, totalValue: 100000, isLowStock: false, stockStatus: "ok" });
    // No balance row = nothing on hand (out of stock), missing names read as an em dash, not as an invented value.
    expect(rows[2]).toMatchObject({ currentStock: 0, totalValue: 0, stockStatus: "out", itemCode: "—", category: "—", unit: "—" });
  });
});

describe("stock-service list: an empty 200 is an empty register, not a load failure", () => {
  it("maps {data: [], limit, offset} to [] (never null)", () => {
    expect(mapStockItemSummaries({ data: [], limit: 50, offset: 0 })).toEqual([]);
    expect(mapStockItemSummaries([])).toEqual([]);
  });
});
