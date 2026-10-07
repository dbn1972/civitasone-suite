import { describe, it, expect, vi, afterEach } from "vitest";
import { searchCatalogueProducts, resolveCatalogueProducts } from "./catalogueProduct";

// GAP-CATALOGUE-RATES-01
describe("catalogueProduct entity adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("searches the server search endpoint and labels by name", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "p1", name: "Birth Certificate", code: "BC" }] }), { status: 200 }),
    );
    const out = await searchCatalogueProducts("birth", new AbortController().signal);
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/catalogue/products?search=birth&limit=20");
    expect(out).toEqual([{ id: "p1", label: "Birth Certificate", sublabel: "BC" }]);
  });

  it("returns [] (not throw) on a failed search", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(searchCatalogueProducts("x", new AbortController().signal)).resolves.toEqual([]);
  });

  it("resolves a seeded id via the product detail endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "p1", name: "Birth Certificate" } }), { status: 200 }),
    );
    expect(await resolveCatalogueProducts(["p1"])).toEqual([{ id: "p1", label: "Birth Certificate" }]);
  });

  it("resolve([]) short-circuits without a fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await resolveCatalogueProducts([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
