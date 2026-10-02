import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaders = vi.hoisted(() => ({ getStockLedger: vi.fn(), getStockItems: vi.fn() }));
vi.mock("@/app/_data/loaders", () => loaders);
vi.mock("../../stock/_components/PrintExportButton", () => ({
  PrintExportButton: () => <button type="button">EXPORT</button>,
}));

const { default: Page } = await import("./page");

const ID = "11111111-2222-3333-4444-555555555555";
const e = (id: string, type: string, signed: number, over: object = {}) => ({
  id, itemId: ID, itemCode: ID.slice(0, 8).toUpperCase(), itemName: ID.slice(0, 8), date: "2026-08-01", type,
  quantity: Math.abs(signed), direction: signed < 0 ? "out" : "in", signedQuantity: signed, unitCost: 0, totalValue: 0, balance: 0, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  loaders.getStockItems.mockResolvedValue({ source: "api", data: [{ id: ID, itemCode: "PEN-01", name: "Gel pen" }] });
});

describe("reconcile page (GAP-INVENTORY-RECONCILE-01/-03/-04/-05)", () => {
  it("is titled for what it computes, not 'Reconciliation'", async () => {
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [e("1", "receipt", 5)] });
    render(await Page({}));
    expect(screen.getByRole("heading", { name: "Stock Movements Summary" })).toBeInTheDocument();
    expect(screen.queryByText(/verify ledger balance/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Net Balance (Qty)")).not.toBeInTheDocument();
  });

  it("joins the item master so the ledger shows the SKU, not a UUID fragment", async () => {
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [e("1", "receipt", 5)] });
    render(await Page({}));
    expect(screen.getByText("PEN-01")).toBeInTheDocument();
    expect(screen.getByText("Gel pen")).toBeInTheDocument();
    expect(screen.queryByText("11111111")).not.toBeInTheDocument();
  });

  it("an item lookup failure keeps the short id and still renders", async () => {
    loaders.getStockItems.mockRejectedValue(new Error("down"));
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [e("1", "receipt", 5)] });
    render(await Page({}));
    expect(screen.getAllByText("11111111").length).toBeGreaterThan(0);
  });

  it("asks for 200 items per page and pages on until every ledger item is named", async () => {
    const filler = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `other-${from + i}`, itemCode: `X-${from + i}`, name: `Other ${from + i}` }));
    loaders.getStockItems
      .mockResolvedValueOnce({ source: "api", data: filler(200, 0) })
      .mockResolvedValueOnce({ source: "api", data: [{ id: ID, itemCode: "PEN-01", name: "Gel pen" }] });
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [e("1", "receipt", 5)] });
    render(await Page({}));
    expect(loaders.getStockItems).toHaveBeenNthCalledWith(1, { limit: 200, offset: 0 });
    expect(loaders.getStockItems).toHaveBeenNthCalledWith(2, { limit: 200, offset: 200 });
    expect(screen.getByText("PEN-01")).toBeInTheDocument();
  });

  it("stops after the first page when every ledger item is already named", async () => {
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [e("1", "receipt", 5)] });
    loaders.getStockItems.mockResolvedValue({
      source: "api",
      data: Array.from({ length: 200 }, (_, i) => ({ id: i === 0 ? ID : `o${i}`, itemCode: i === 0 ? "PEN-01" : `X${i}`, name: "n" })),
    });
    render(await Page({}));
    expect(loaders.getStockItems).toHaveBeenCalledTimes(1);
  });

  it("shows a Transfers count", async () => {
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [e("1", "transfer", -2), e("2", "transfer", 2), e("3", "receipt", 5)] });
    render(await Page({}));
    expect(screen.getByText("Transfers").closest(".stat")?.textContent).toContain("2");
  });

  it("asks the service for its maximum page and warns when that page is full", async () => {
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: Array.from({ length: 500 }, (_, i) => e(String(i), "receipt", 1)) });
    render(await Page({}));
    expect(loaders.getStockLedger).toHaveBeenCalledWith({ limit: 500 });
    expect(screen.getByRole("note")).toHaveTextContent(/first 500 stock ledger movements/);
  });

  it("forwards valid from/to dates to the service and ignores malformed ones", async () => {
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [e("1", "receipt", 1)] });
    render(await Page({ searchParams: { from: "2026-08-01", to: "not-a-date" } }));
    expect(loaders.getStockLedger).toHaveBeenCalledWith({ limit: 500, from: "2026-08-01" });
    expect(screen.getByRole("link", { name: "Clear dates" })).toBeInTheDocument();
  });

  it("a date range with no movements says so (and a failed load is still an error, not that)", async () => {
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [] });
    const { unmount } = render(await Page({ searchParams: { from: "2026-08-01" } }));
    expect(screen.getByText("No stock movements in this period")).toBeInTheDocument();
    unmount();
    loaders.getStockLedger.mockResolvedValue({ source: "error", data: [] });
    render(await Page({}));
    expect(screen.queryByText("No stock movements in this period")).not.toBeInTheDocument();
    expect(screen.queryByText("No stock movements yet")).not.toBeInTheDocument();
  });

  it("uses the sibling back-nav and offers an export", async () => {
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [e("1", "receipt", 1)] });
    const { container } = render(await Page({}));
    expect(container.querySelector("nav.back")).not.toBeNull();
    expect(container.querySelector("nav.crumbs")).toBeNull();
    expect(screen.getByText("EXPORT")).toBeInTheDocument();
  });
});
