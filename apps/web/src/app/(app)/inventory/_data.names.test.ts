import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: fetchJsonMock }));
const lookups = vi.hoisted(() => ({ getItemNames: vi.fn(), getStoreNames: vi.fn(), getWarehouseNames: vi.fn() }));
vi.mock("./_lookups", () => lookups);

const data = await import("./_data");

beforeEach(() => {
  vi.clearAllMocks();
  lookups.getItemNames.mockResolvedValue(new Map([["i1", { name: "Toner", sku: "T-1" }]]));
  lookups.getStoreNames.mockResolvedValue(new Map([["s1", "Main Store"]]));
  lookups.getWarehouseNames.mockResolvedValue(new Map([["w1", "Depot"]]));
});

describe("inventory loaders resolve names (GAP-INVENTORY-BINS-02 / GOODS-RETURNS-02 / ISSUES-03 / LIST-03)", () => {
  it("bins carry the store name, null when unresolved", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [{ id: "b1", storeId: "s1" }, { id: "b2", storeId: "zz" }] });
    const res = await data.getInventoryBins();
    expect(res.data.map((b) => b.storeName)).toEqual(["Main Store", null]);
    expect(fetchJsonMock.mock.calls[0][0]).toContain("limit=200");
  });

  it("goods returns carry item, sku and store names", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [{ id: "g", itemId: "i1", storeId: "s1" }] });
    const [row] = (await data.getInventoryGoodsReturns()).data;
    expect(row).toMatchObject({ itemName: "Toner", itemSku: "T-1", storeName: "Main Store" });
  });

  it("names:false skips the lookups (hub only counts rows)", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [{ id: "g", itemId: "i1", storeId: "s1" }] });
    await data.getInventoryGoodsReturns({ names: false });
    expect(lookups.getItemNames).not.toHaveBeenCalled();
  });

  it("cycle counts carry item and warehouse names", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [{ id: "c", itemId: "i1", warehouseId: "w1" }] });
    const [row] = (await data.getInventoryCycleCounts("pending_approval")).data;
    expect(row).toMatchObject({ itemName: "Toner", warehouseName: "Depot" });
  });

  it("a failed primary fetch is passed through untouched (no lookups)", async () => {
    fetchJsonMock.mockResolvedValue({ source: "error", data: [], status: 500 });
    const res = await data.getInventoryBins();
    expect(res.source).toBe("error");
    expect(lookups.getStoreNames).not.toHaveBeenCalled();
  });

  it("a failing lookup degrades to unnamed rows instead of failing the register", async () => {
    lookups.getStoreNames.mockRejectedValue(new Error("down"));
    fetchJsonMock.mockResolvedValue({ source: "api", data: [{ id: "b1", storeId: "s1" }] });
    const res = await data.getInventoryBins();
    expect(res.source).toBe("api");
    expect(res.data).toHaveLength(1);
  });
});

describe("GAP-INVENTORY-ISSUES-02 / ITEMS-04: requests", () => {
  it("the ledger is filtered by movement type server-side and asks for the full page", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [] });
    await data.getInventoryLedger({ movementType: "issue" });
    const path = String(fetchJsonMock.mock.calls[0][0]);
    expect(path).toContain("movementType=issue");
    expect(path).toContain("limit=500");
  });

  it("the item master asks for 200, not the service default of 50", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [] });
    await data.getInventoryItems();
    expect(String(fetchJsonMock.mock.calls[0][0])).toContain("limit=200");
  });
});

describe("low-stock and reservations carry names (GAP-INVENTORY-LOW-STOCK-03 / RESERVATIONS-03)", () => {
  it("low-stock rows carry the store name, null when unresolved", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [{ itemId: "i1", storeId: "s1" }, { itemId: "i1", storeId: "zz" }] });
    const res = await data.getInventoryLowStock();
    expect(res.data.map((r) => r.storeName)).toEqual(["Main Store", null]);
  });

  it("a failed low-stock fetch passes through untouched", async () => {
    fetchJsonMock.mockResolvedValue({ source: "error", data: [] });
    expect((await data.getInventoryLowStock()).source).toBe("error");
    expect(lookups.getStoreNames).not.toHaveBeenCalled();
  });

  it("reservations carry item, sku and store names", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [{ id: "r", itemId: "i1", storeId: "s1" }, { id: "r2", itemId: "zz", storeId: "s1" }] });
    const res = await data.getInventoryReservations();
    expect(res.data[0]).toMatchObject({ itemName: "Toner", itemSku: "T-1", storeName: "Main Store" });
    expect(res.data[1]).toMatchObject({ itemName: null, itemSku: null });
  });
});

