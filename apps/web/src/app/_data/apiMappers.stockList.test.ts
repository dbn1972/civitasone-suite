/**
 * GAP-STOCK-LIST-02: the item list maps the service's joined category name and UOM code, and
 * never surfaces an id fragment or an invented unit/category when they are absent.
 */
import { describe, it, expect } from "vitest";
import { mapStockItemSummaries } from "./apiMappers";

const CAT_ID = crypto.randomUUID();
const UOM_ID = crypto.randomUUID();
const base = { id: crypto.randomUUID(), name: "A4 Paper", code: "PAP-A4", categoryId: CAT_ID, uomId: UOM_ID, reorderLevel: 4 };

describe("mapStockItemSummaries with the stock-service joined names", () => {
  it("maps the item code, category name and UOM code", () => {
    const [it0] = mapStockItemSummaries({ data: [{ ...base, categoryName: "Stationery", uomCode: "rm" }] })!;
    expect(it0).toMatchObject({ itemCode: "PAP-A4", category: "Stationery", unit: "rm" });
  });

  it("falls back to dashes (never id fragments, never EA/General) when names are not joined", () => {
    const [it0] = mapStockItemSummaries({ data: [{ ...base }] })!;
    expect(it0!.category).toBe("—");
    expect(it0!.unit).toBe("—");
    const shown = JSON.stringify([it0!.category, it0!.unit, it0!.itemCode]);
    expect(shown).not.toContain(CAT_ID.slice(0, 8));
    expect(shown).not.toContain(UOM_ID.slice(0, 4));
  });
});
