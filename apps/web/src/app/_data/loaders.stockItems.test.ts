import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/_data/apiClient")>()),
  fetchJson: fetchJsonMock,
}));

const { getStockItems } = await import("./loaders");

beforeEach(() => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue({ source: "api", data: [] });
});

describe("getStockItems limit (GAP-INVENTORY-RECONCILE-03)", () => {
  it("no argument keeps the original URL", async () => {
    await getStockItems();
    expect(fetchJsonMock.mock.calls[0][0]).toBe("/api/v1/stock/items");
  });

  it("limit and offset go on the query string", async () => {
    await getStockItems({ limit: 200 });
    expect(fetchJsonMock.mock.calls[0][0]).toBe("/api/v1/stock/items?limit=200");
    await getStockItems({ limit: 200, offset: 400 });
    expect(fetchJsonMock.mock.calls[1][0]).toBe("/api/v1/stock/items?limit=200&offset=400");
  });
});
