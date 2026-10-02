import { describe, it, expect } from "vitest";
import { mapStockItemSummaries } from "./apiMappers";

const base = { id: "i1", name: "Pen", code: "P-1", reorderLevel: 5 };

describe("mapStockItemSummaries: missing levels are unknown, not zero", () => {
  it("an item with no currentStock/cost maps to nulls and is NOT low stock", () => {
    const [row] = mapStockItemSummaries({ data: [base] })!;
    expect(row).toMatchObject({ currentStock: null, unitCost: null, totalValue: null, isLowStock: null });
  });

  it("a reported level still drives low-stock (at or below reorder level)", () => {
    const rows = mapStockItemSummaries({
      data: [
        { ...base, id: "a", currentStock: 5, unitCost: 100, totalValue: 500 },
        { ...base, id: "b", currentStock: 6 },
        { ...base, id: "c", currentStock: 0, totalValue: "0" },
      ],
    })!;
    expect(rows.map((r) => r.isLowStock)).toEqual([true, false, true]);
    expect(rows[0]).toMatchObject({ currentStock: 5, unitCost: 100, totalValue: 500 });
    expect(rows[2]!.totalValue).toBe(0); // a reported zero stays 0
  });
});
