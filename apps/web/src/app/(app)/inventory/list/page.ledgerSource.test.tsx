import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaders = vi.hoisted(() => ({ getStockItems: vi.fn() }));
vi.mock("@/app/_data/loaders", () => loaders);
const inv = vi.hoisted(() => ({ getInventoryCycleCounts: vi.fn() }));
vi.mock("../_data", () => inv);
const links = vi.hoisted(() => ({ getItemLinks: vi.fn() }));
vi.mock("../_dataLinks", () => links);
const ledger = vi.hoisted(() => ({ getInventoryLedgerSource: vi.fn(), getAllInventoryItems: vi.fn(), getInventoryBalances: vi.fn() }));
vi.mock("../_dataLedger", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_dataLedger")>()), ...ledger }));
const client = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("./InventoryStockListClient", () => ({
  InventoryStockListClient: (p: Record<string, unknown>) => { client.props = p; return <div>STOCK REGISTER</div>; },
}));

const { default: Page } = await import("./page");

const ITEM = { id: "i1", name: "A4 Paper", sku: "A4", status: "active", category: "Stationery", uom: "REAM", itemType: "consumable", reorderLevel: 5, reorderQty: 0, unitCostMinor: "0" };

beforeEach(() => {
  vi.clearAllMocks();
  client.props = null;
  inv.getInventoryCycleCounts.mockResolvedValue({ data: [], source: "api" });
  links.getItemLinks.mockResolvedValue({ data: [], source: "api" });
  loaders.getStockItems.mockResolvedValue({ data: [], source: "api" });
  ledger.getInventoryLedgerSource.mockResolvedValue({ data: "stock", source: "api" });
  ledger.getAllInventoryItems.mockResolvedValue({ data: [ITEM], source: "api" });
  ledger.getInventoryBalances.mockResolvedValue({ data: [{ itemId: "i1", storeId: "s1", onHandQty: 70, valueMinor: "1750000" }], source: "api" });
});

describe("/inventory/list", () => {
  it("ledger source 'inventory': lists item-master rows with their balances and never calls stock-service or the link report", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ data: "inventory", source: "api" });
    render(await Page());
    expect(screen.getByText("STOCK REGISTER")).toBeInTheDocument();
    expect(loaders.getStockItems).not.toHaveBeenCalled();
    expect(links.getItemLinks).not.toHaveBeenCalled();
    const p = client.props as { items: Array<{ currentStock: number; totalValue: number }>; showLinkColumn: boolean; rowLinkPrefix: string };
    expect(p.items[0]).toMatchObject({ currentStock: 70, totalValue: 1750000 });
    expect(p.showLinkColumn).toBe(false);
    expect(p.rowLinkPrefix).toBe("/inventory/items/");
  });

  it("an item with no balance rows is out of stock, and an empty item master is an empty register, not an error", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ data: "inventory", source: "api" });
    ledger.getInventoryBalances.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect((client.props as { items: Array<{ stockStatus: string }> }).items[0]?.stockStatus).toBe("out");

    ledger.getAllInventoryItems.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
  });

  it("inventory ledger: a failed balance read is a load failure, never a register of zeros", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ data: "inventory", source: "api" });
    ledger.getInventoryBalances.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await Page());
    expect(screen.queryByText("STOCK REGISTER")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("default (and unreadable setting): still the stock-service register, unchanged", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ data: "stock", source: "error", status: 500 });
    render(await Page());
    expect(loaders.getStockItems).toHaveBeenCalled();
    expect(ledger.getAllInventoryItems).not.toHaveBeenCalled();
    expect((client.props as { showLinkColumn?: boolean }).showLinkColumn).toBeUndefined();
  });

  it("stock-service 403 says access is restricted instead of 'could not load'", async () => {
    loaders.getStockItems.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "requires one of: stock_manager" });
    render(await Page());
    expect(screen.queryByText("STOCK REGISTER")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
