import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: fetchJsonMock }));

const { getInventorySubstitutes } = await import("./_data");

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}` }));

// First call is the item master; the rest are per-item substitute fetches.
function wire(itemCount: number, failItem: (i: number) => boolean = () => false) {
  fetchJsonMock.mockImplementation(async (...args: unknown[]) => {
    const path = String(args[0]);
    if (path === "/api/v1/inventory/items" || path.startsWith("/api/v1/inventory/items?")) {
      return { data: items(itemCount), source: "api" };
    }
    const idx = Number(/items\/item-(\d+)\/substitutes/.exec(path)?.[1]);
    return failItem(idx) ? { data: [], source: "error", status: 500 } : { data: [{ id: `s-${idx}`, itemId: `item-${idx}` }], source: "api" };
  });
}

beforeEach(() => fetchJsonMock.mockReset());

describe("GAP-INVENTORY-SUBSTITUTES-02: getInventorySubstitutes coverage", () => {
  it("60 items: only 50 per-item fetches, truncated true", async () => {
    wire(60);
    const res = await getInventorySubstitutes();
    const perItem = fetchJsonMock.mock.calls.filter(([p]) => String(p).includes("/substitutes"));
    expect(perItem).toHaveLength(50);
    expect(res).toMatchObject({ truncated: true, failedCount: 0, itemCount: 60, source: "api" });
  });

  it("1 of 3 fetches failing: still source api with the other rows, failedCount 1", async () => {
    wire(3, (i) => i === 1);
    const res = await getInventorySubstitutes();
    expect(res.source).toBe("api");
    expect(res.failedCount).toBe(1);
    expect(res.data).toHaveLength(2);
    expect(res.truncated).toBe(false);
  });

  it("every fetch failing is an error", async () => {
    wire(2, () => true);
    const res = await getInventorySubstitutes();
    expect(res.source).toBe("error");
    expect(res.failedCount).toBe(2);
  });
});

describe("GAP-INVENTORY-SUBSTITUTES-03: names from the item master", () => {
  it("names both the item and the substitute; a substitute outside the item page stays null", async () => {
    fetchJsonMock.mockImplementation(async (...args: unknown[]) => {
      const path = String(args[0]);
      if (path.startsWith("/api/v1/inventory/items?")) {
        return { data: [{ id: "a", name: "Gel pen", sku: "PEN-01" }, { id: "b", name: "Ball pen", sku: null }], source: "api" };
      }
      return path.includes("/items/a/")
        ? { data: [{ id: "s1", itemId: "a", substituteId: "b" }, { id: "s2", itemId: "a", substituteId: "zzz" }], source: "api" }
        : { data: [], source: "api" };
    });
    const res = await getInventorySubstitutes();
    expect(res.data[0]).toMatchObject({ itemName: "Gel pen", itemSku: "PEN-01", substituteName: "Ball pen", substituteSku: null });
    expect(res.data[1]).toMatchObject({ substituteName: null });
  });
});

