import { describe, it, expect } from "vitest";
import { countBadge, pickMostBelowReorder } from "./hubStats";

const r = (name: string, onHandQty: number, reorderLevel: number) => ({
  itemId: name, storeId: "s", name, sku: null, onHandQty, reorderLevel, suggestedReorderQty: 1,
});

describe("pickMostBelowReorder (GAP-INVENTORY-HOME-02)", () => {
  it("picks the lowest on-hand/reorder ratio whatever the API order", () => {
    expect(pickMostBelowReorder([r("A", 9, 10), r("B", 2, 10)])?.name).toBe("B");
    expect(pickMostBelowReorder([r("B", 2, 10), r("A", 9, 10)])?.name).toBe("B");
  });
  it("never divides by zero and ranks a zero reorder level last", () => {
    expect(pickMostBelowReorder([r("Z", 0, 0), r("A", 9, 10)])?.name).toBe("A");
    expect(pickMostBelowReorder([r("Z", 0, 0)])?.name).toBe("Z");
  });
  it("breaks ties on the larger shortfall, then name", () => {
    expect(pickMostBelowReorder([r("A", 5, 10), r("B", 10, 20)])?.name).toBe("B");
    expect(pickMostBelowReorder([r("B", 5, 10), r("A", 5, 10)])?.name).toBe("A");
  });
  it("returns undefined for no rows", () => {
    expect(pickMostBelowReorder([])).toBeUndefined();
  });
});

describe("countBadge (GAP-INVENTORY-HOME-03)", () => {
  it("shows a dash, never a zero, when the count failed", () => {
    expect(countBadge(null, "low").text).toBe("—");
  });
  it("shows N+ when the fetched page was full (count is a lower bound)", () => {
    expect(countBadge(200, "pending QC", true).text).toBe("200+ pending QC");
    expect(countBadge(7, "pending QC", false).text).toBe("7 pending QC");
  });
  it("warns only when the count is above zero", () => {
    expect(countBadge(3, "low")).toEqual({ text: "3 low", tone: "warn" });
    expect(countBadge(0, "low").tone).toBe("info");
  });
});
