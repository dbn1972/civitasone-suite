import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./ItemLinkActions", () => ({ ItemLinkActions: () => <div data-testid="link-actions" /> }));
const data = vi.hoisted(() => ({ getInventoryItemDetail: vi.fn(), getItemStockLink: vi.fn() }));
vi.mock("../../_dataLinks", () => data);
const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn(() => ["inventory_user"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()), ...auth }));

const { default: Page } = await import("./page");

const ITEM = { id: "i1", name: "Gel Pen", sku: "PEN-01", status: "active", category: "Stationery", uom: "EA", itemType: "consumable", reorderLevel: 10, reorderQty: 50, unitCostMinor: "500", hsnCode: "9608" };
const LINK = { id: "l1", inventoryItemId: "i1", stockItemId: "s1", stockItemCode: "pen-01", stockItemName: "Gel Pen Blue", source: "manual" as const, linkedBy: "u", linkedAt: "2026-10-03T00:00:00Z" };
const LINKED = {
  inventoryItemId: "i1", linked: true, link: LINK, stockAvailable: true, suggestion: null,
  stock: {
    item: { id: "s1", code: "pen-01", name: "Gel Pen Blue", uom: "EA" },
    balances: { itemId: "s1", totalQty: 15, totalValueMinor: "8000", warehouses: [{ warehouseId: "aaaaaaaa-1111-4000-8000-000000000001", qty: 10, rateMinor: "500", valueMinor: "5000" }, { warehouseId: "bbbbbbbb-1111-4000-8000-000000000002", qty: 5, rateMinor: "600", valueMinor: "3000" }] },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSessionRoles.mockReturnValue(["inventory_user"]);
  data.getInventoryItemDetail.mockResolvedValue({ source: "api", data: ITEM });
  data.getItemStockLink.mockResolvedValue({ source: "api", data: LINKED });
});

async function show() {
  render(await Page({ params: { id: "i1" } }));
}

describe("item master detail: one item, with its linked stock-side balances", () => {
  it("shows the link, a way to the stock register entry, the on-hand total and each warehouse", async () => {
    await show();
    expect(screen.getByText(/Linked to stock register item pen-01 · Gel Pen Blue/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open stock register entry" })).toHaveAttribute("href", "/inventory/s1");
    expect(screen.getByText("On-hand quantity").nextSibling).toHaveTextContent("15");
    expect(screen.getByText("Stock value").nextSibling).toHaveTextContent("₹80.00");
    expect(screen.getByText("By warehouse", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("aaaaaaaa")).toBeInTheDocument();
    expect(screen.queryByTestId("link-actions")).not.toBeInTheDocument(); // not an admin
  });

  it("an unlinked item says so plainly and points at the report; admins get the link controls", async () => {
    data.getItemStockLink.mockResolvedValue({ source: "api", data: { inventoryItemId: "i1", linked: false, link: null, stock: null, stockAvailable: true, suggestion: null } });
    auth.getSessionRoles.mockReturnValue(["inventory_admin"]);
    await show();
    expect(screen.getByText(/not linked to a stock register item/i)).toBeInTheDocument();
    expect(screen.getAllByText("Not linked").length).toBeGreaterThan(0);
    expect(screen.getByTestId("link-actions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review unlinked items" })).toHaveAttribute("href", "/inventory/items/unlinked");
  });

  it("when stock-service is unavailable the link is still shown and the balances say they could not load", async () => {
    data.getItemStockLink.mockResolvedValue({ source: "api", data: { ...LINKED, stockAvailable: false, stock: null } });
    await show();
    expect(screen.getByText(/Linked to stock register item pen-01/)).toBeInTheDocument();
    expect(screen.getByText(/Stock balances could not be loaded right now/)).toBeInTheDocument();
    expect(screen.queryByText("On-hand quantity")).not.toBeInTheDocument();
  });

  it("a failed link read is an error state, never a false 'not linked'", async () => {
    data.getItemStockLink.mockResolvedValue({ source: "error", status: 502, data: null });
    await show();
    expect(screen.queryByText(/not linked to a stock register item/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Gel Pen", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("a real 404 is 'Item not found', other failures are retryable errors", async () => {
    data.getInventoryItemDetail.mockResolvedValue({ source: "error", status: 404, data: null });
    await show();
    expect(screen.getByText("Item not found")).toBeInTheDocument();
  });

  it("a 500 on the item itself is an error, not 'Item not found'", async () => {
    data.getInventoryItemDetail.mockResolvedValue({ source: "error", status: 500, data: null });
    await show();
    expect(screen.queryByText("Item not found")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
