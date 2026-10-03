import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const data = vi.hoisted(() => ({ getItemLinkByStock: vi.fn(), getInventoryItemDetail: vi.fn() }));
vi.mock("./_dataLinks", () => data);
const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn(() => ["inventory_user"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()), ...auth }));

const { RegisterLinkCard } = await import("./RegisterLinkCard");

const LINK = { id: "l1", inventoryItemId: "i1", stockItemId: "s1", stockItemCode: "pen-01", stockItemName: "Gel Pen Blue", source: "manual" as const, linkedBy: "u", linkedAt: "" };
beforeEach(() => {
  vi.clearAllMocks();
  auth.getSessionRoles.mockReturnValue(["inventory_user"]);
  data.getInventoryItemDetail.mockResolvedValue({ source: "api", data: { id: "i1", name: "Gel Pen", sku: "PEN-01" } });
});
const show = async () => render(await RegisterLinkCard({ stockItemId: "s1" }));

describe("stock register item: link to the item master", () => {
  it("shows the item master entry it is linked to, named from the item master", async () => {
    data.getItemLinkByStock.mockResolvedValue({ source: "api", data: LINK });
    await show();
    expect(screen.getByText(/Linked to item master entry PEN-01 · Gel Pen/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open item master entry" })).toHaveAttribute("href", "/inventory/items/i1");
  });

  it("an unlinked item says so; only admins are pointed at the report", async () => {
    data.getItemLinkByStock.mockResolvedValue({ source: "api", data: null });
    await show();
    expect(screen.getByText(/exists in the stock register only/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review unlinked items" })).not.toBeInTheDocument();
  });

  it("admins get the report link on an unlinked item", async () => {
    auth.getSessionRoles.mockReturnValue(["inventory_admin"]);
    data.getItemLinkByStock.mockResolvedValue({ source: "api", data: null });
    await show();
    expect(screen.getByRole("link", { name: "Review unlinked items" })).toHaveAttribute("href", "/inventory/items/unlinked");
  });

  it("a failed link read never claims the item is unlinked", async () => {
    data.getItemLinkByStock.mockResolvedValue({ source: "error", status: 502, data: null });
    await show();
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/stock register only/)).not.toBeInTheDocument();
  });
});
