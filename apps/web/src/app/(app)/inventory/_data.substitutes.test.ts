import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: fetchJsonMock }));

const { getInventorySubstitutes } = await import("./_data");

type Sub = { id: string; itemId: string; substituteId: string };

// Substitutes come from ONE tenant-wide read; the item master is read only to name both ends.
function wire(opts: { subs?: Sub[]; subsFail?: boolean; items?: Array<{ id: string; name: string; sku?: string | null }> }) {
  fetchJsonMock.mockImplementation(async (...args: unknown[]) => {
    const path = String(args[0]);
    if (path.startsWith("/api/v1/inventory/substitutes")) {
      return opts.subsFail ? { data: [], source: "error", status: 500 } : { data: opts.subs ?? [], source: "api" };
    }
    if (path.startsWith("/api/v1/inventory/items")) {
      return { data: opts.items ?? [], source: "api" };
    }
    return { data: [], source: "api" };
  });
}

beforeEach(() => fetchJsonMock.mockReset());

describe("GAP-INVENTORY-SUBSTITUTES-04: bulk substitutes read (no per-item fan-out)", () => {
  it("makes exactly one substitutes request, however many items exist", async () => {
    wire({ subs: [{ id: "s1", itemId: "a", substituteId: "b" }], items: Array.from({ length: 120 }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}` })) });
    const res = await getInventorySubstitutes();
    const subsCalls = fetchJsonMock.mock.calls.filter(([p]) => String(p).includes("/substitutes"));
    expect(subsCalls).toHaveLength(1);
    expect(String(subsCalls[0]![0])).toBe("/api/v1/inventory/substitutes?limit=200");
    expect(res).toMatchObject({ source: "api", truncated: false, failedCount: 0, itemCount: 120 });
    expect(res.data).toHaveLength(1);
  });

  it("a full page is reported as truncated", async () => {
    wire({ subs: Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, itemId: "a", substituteId: `b${i}` })) });
    const res = await getInventorySubstitutes();
    expect(res.truncated).toBe(true);
    expect(res.data).toHaveLength(200);
  });

  it("a failed substitutes read is an error, not an empty register", async () => {
    wire({ subsFail: true });
    const res = await getInventorySubstitutes();
    expect(res.source).toBe("error");
    expect(res.data).toEqual([]);
  });
});

describe("GAP-INVENTORY-SUBSTITUTES-03: names from the item master", () => {
  it("names both the item and the substitute; a substitute outside the item page stays null", async () => {
    wire({
      subs: [{ id: "s1", itemId: "a", substituteId: "b" }, { id: "s2", itemId: "a", substituteId: "zzz" }],
      items: [{ id: "a", name: "Gel pen", sku: "PEN-01" }, { id: "b", name: "Ball pen", sku: null }],
    });
    const res = await getInventorySubstitutes();
    expect(res.data[0]).toMatchObject({ itemName: "Gel pen", itemSku: "PEN-01", substituteName: "Ball pen", substituteSku: null });
    expect(res.data[1]).toMatchObject({ substituteName: null });
  });

  it("still lists the links when the item master cannot be read (names fall back)", async () => {
    fetchJsonMock.mockImplementation(async (...args: unknown[]) => {
      const path = String(args[0]);
      return path.startsWith("/api/v1/inventory/substitutes")
        ? { data: [{ id: "s1", itemId: "a", substituteId: "b" }], source: "api" }
        : { data: [], source: "error", status: 500 };
    });
    const res = await getInventorySubstitutes();
    expect(res.source).toBe("api");
    expect(res.data[0]).toMatchObject({ itemName: null, substituteName: null });
  });
});
