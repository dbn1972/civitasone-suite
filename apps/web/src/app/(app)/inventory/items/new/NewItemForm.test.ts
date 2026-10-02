import { describe, it, expect } from "vitest";
import { buildItemBody } from "./NewItemForm";

const v = (o: Record<string, string> = {}) => ({
  name: "Toner", sku: "", itemType: "consumable" as const, categoryId: "", uomId: "",
  reorderLevel: "", reorderQty: "", unitCost: "", ...o,
});

describe("buildItemBody (GAP-INVENTORY-ITEMS-03)", () => {
  it("converts rupees to integer paise without float math", () => {
    const r = buildItemBody(v({ unitCost: "12.50", reorderLevel: "5" }));
    expect(r).toEqual({ ok: true, body: { name: "Toner", itemType: "consumable", unitCostMinor: 1250, reorderLevel: 5 } });
    const r2 = buildItemBody(v({ unitCost: "1,20,000.05" }));
    expect(r2.ok && r2.body.unitCostMinor).toBe(12000005);
  });
  it("rejects sub-paise amounts, a blank name and a negative reorder level", () => {
    const r = buildItemBody(v({ name: " ", unitCost: "1.005", reorderLevel: "-1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["name", "reorderLevel", "unitCost"]);
  });
});
