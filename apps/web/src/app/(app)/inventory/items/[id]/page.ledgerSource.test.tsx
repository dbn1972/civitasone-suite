import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./ItemLinkActions", () => ({ ItemLinkActions: () => <div data-testid="link-actions" /> }));
const links = vi.hoisted(() => ({ getInventoryItemDetail: vi.fn(), getItemStockLink: vi.fn() }));
vi.mock("../../_dataLinks", () => links);
const ledger = vi.hoisted(() => ({ getInventoryLedgerSource: vi.fn(), getInventoryItemBalances: vi.fn() }));
vi.mock("../../_dataLedger", () => ledger);
const inv = vi.hoisted(() => ({ getInventoryStoreOptions: vi.fn() }));
vi.mock("../../_data", () => inv);
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()), getSessionRoles: () => ["inventory_admin"] }));

const { default: Page } = await import("./page");
const ITEM = { id: "i1", name: "A4 Paper", sku: "A4", status: "active", category: "Stationery", uom: "REAM", itemType: "consumable", reorderLevel: 5, reorderQty: 0, unitCostMinor: "25000", hsnCode: null };
const show = async () => render(await Page({ params: Promise.resolve({ id: "i1" }) }));

beforeEach(() => {
  vi.clearAllMocks();
  links.getInventoryItemDetail.mockResolvedValue({ source: "api", data: ITEM });
  links.getItemStockLink.mockResolvedValue({ source: "api", data: { inventoryItemId: "i1", linked: false, link: null, stock: null, stockAvailable: true, suggestion: null } });
  inv.getInventoryStoreOptions.mockResolvedValue({ source: "api", data: [{ id: "s1", name: "Main Store" }, { id: "s2", name: "Annex" }] });
});

describe("item detail on the inventory ledger", () => {
  it("shows stock per store and no 'not linked' message or link controls", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ source: "api", data: "inventory" });
    ledger.getInventoryItemBalances.mockResolvedValue({ source: "api", data: [
      { itemId: "i1", storeId: "s1", onHandQty: 70, valueMinor: "1750000" },
      { itemId: "i1", storeId: "s2", onHandQty: 10, valueMinor: "250000" },
    ] });
    await show();
    expect(screen.getByText("Stock on hand")).toBeInTheDocument();
    expect(screen.getByText("On-hand quantity").nextSibling).toHaveTextContent("80");
    expect(screen.getAllByText("Stock value")[0]!.nextSibling).toHaveTextContent("₹20,000.00");
    expect(screen.getByText("Main Store")).toBeInTheDocument();
    expect(screen.queryByText(/not linked to a stock register item/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-actions")).not.toBeInTheDocument();
    expect(links.getItemStockLink).not.toHaveBeenCalled();
  });

  it("an item nothing has been received for says so, not an error", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ source: "api", data: "inventory" });
    ledger.getInventoryItemBalances.mockResolvedValue({ source: "api", data: [] });
    await show();
    expect(screen.getByText("No stock has been received into any store yet.")).toBeInTheDocument();
  });

  it("the default keeps the stock-register link card", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ source: "api", data: "stock" });
    await show();
    expect(screen.getByText(/not linked to a stock register item/i)).toBeInTheDocument();
    expect(ledger.getInventoryItemBalances).not.toHaveBeenCalled();
  });
});
