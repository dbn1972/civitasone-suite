import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchItemEntries, resolveStockItemEntry } from "./item";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("entityAdapters/item", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("searchItemEntries calls the single-picker route with q, limit, masters and the AbortSignal", async () => {
    const entry = { key: "i1", kind: "linked", inventoryItemId: "i1", stockItemId: "s1", code: "PEN-01", name: "Gel Pen", stockCode: "pen-01" };
    fetchMock.mockResolvedValue(json({ data: [entry] }));
    const ctl = new AbortController();
    const out = await searchItemEntries("gel pen", ctl.signal, "stock");
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/inventory/item-picker?q=gel+pen&limit=20&masters=stock", { signal: ctl.signal });
    expect(out).toEqual([entry]);
  });

  it("returns an empty list on a non-ok response rather than throwing", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    expect(await searchItemEntries("x", new AbortController().signal)).toEqual([]);
  });

  it("resolveStockItemEntry returns the merged linked item (named by the item master) for a linked stock id", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/proxy/v1/stock/items/")) return json({ id: "s1", code: "pen-01", name: "Gel Pen Blue" });
      if (url.startsWith("/api/proxy/v1/inventory/item-links/lookup")) return json({ data: { inventoryItemId: "i1" } });
      if (url.startsWith("/api/proxy/v1/inventory/items/i1")) return json({ id: "i1", name: "Gel Pen", sku: "PEN-01" });
      throw new Error(`unexpected ${url}`);
    });
    expect(await resolveStockItemEntry("s1")).toEqual({
      key: "i1", kind: "linked", inventoryItemId: "i1", stockItemId: "s1", code: "PEN-01", name: "Gel Pen", stockCode: "pen-01",
    });
  });

  it("resolveStockItemEntry falls back to a stock-only entry when there is no link, and null for an unknown id", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/proxy/v1/stock/items/")) return json({ id: "s2", itemCode: "STAP-1", name: "Stapler" });
      return json({ data: null });
    });
    expect(await resolveStockItemEntry("s2")).toMatchObject({ key: "s2", kind: "stock_only", inventoryItemId: null, stockItemId: "s2", code: "STAP-1" });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect(await resolveStockItemEntry("nope")).toBeNull();
  });
});
