import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: fetchJsonMock }));
const lookups = vi.hoisted(() => ({
  getItemNames: vi.fn(async () => new Map()),
  getStoreNames: vi.fn(async () => new Map()),
  getWarehouseNames: vi.fn(async () => new Map()),
  getSupplierNames: vi.fn(async () => new Map([["v-1", "Acme Stationers"]])),
}));
vi.mock("./_lookups", () => lookups);

const { getInventoryLedger, getInventorySettings, getInventoryMovementById } = await import("./_data");

beforeEach(() => {
  fetchJsonMock.mockReset();
  lookups.getSupplierNames.mockClear();
});

describe("receipts ledger supplier names (GAP-INVENTORY-RECEIPTS-03)", () => {
  it("resolves the supplier name from the supplier id, and null when unknown", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: [
        { id: "l1", movementId: "m1", movementType: "receipt", itemId: "i", storeId: "s", supplierId: "v-1", grnNo: "G-1", poRef: "P-1" },
        { id: "l2", movementId: "m2", movementType: "receipt", itemId: "i", storeId: "s", supplierId: "v-404" },
      ],
    });
    const res = await getInventoryLedger({ movementType: "receipt" });
    expect(res.data[0]).toMatchObject({ supplierName: "Acme Stationers", grnNo: "G-1", poRef: "P-1" });
    expect(res.data[1]?.supplierName).toBeNull();
  });

  it("does not call the vendor lookup when no row has a supplier (issues, manual receipts)", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [{ id: "l1", movementId: "m1", movementType: "issue", itemId: "i", storeId: "s" }] });
    await getInventoryLedger({ movementType: "issue" });
    expect(lookups.getSupplierNames).not.toHaveBeenCalled();
  });
});

describe("getInventorySettings (GAP-INVENTORY-GOODS-RETURNS-DETAIL-04)", () => {
  it("maps the boolean and defaults to ON when the service is unreadable", async () => {
    let mapped: ((p: unknown) => unknown) | undefined;
    fetchJsonMock.mockImplementation(async (_p: string, fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
      mapped = opts.mapResponse;
      return { source: "error", data: fallback };
    });
    const res = await getInventorySettings();
    expect(res.data).toEqual({ qcMakerChecker: true });
    expect(mapped!({ data: { qcMakerChecker: false } })).toEqual({ qcMakerChecker: false });
    expect(mapped!({ data: {} })).toBeNull();
  });
});

describe("getInventoryMovementById", () => {
  it("names the lines and stores from the lookups", async () => {
    lookups.getItemNames.mockResolvedValueOnce(new Map([["i-1", { name: "Toner", sku: "T-1" }]]) as never);
    lookups.getStoreNames.mockResolvedValueOnce(new Map([["s-1", "Central Store"]]) as never);
    fetchJsonMock.mockImplementation(async (_p: string, _f: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
      source: "api",
      data: opts.mapResponse({ data: { id: "m-1", toStoreId: "s-1", lines: [{ id: "l", itemId: "i-1", qty: 2, rateMinor: "1", amountMinor: "2" }] } }),
    }));
    const res = await getInventoryMovementById("m-1");
    expect(res.data?.toStoreName).toBe("Central Store");
    expect(res.data?.lines[0]).toMatchObject({ itemName: "Toner", itemSku: "T-1" });
    expect(String(fetchJsonMock.mock.calls[0]![0])).toBe("/api/v1/inventory/movements/m-1");
  });
});
