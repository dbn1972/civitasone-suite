import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaders = vi.hoisted(() => ({ getStockLedger: vi.fn(), getStockItems: vi.fn() }));
vi.mock("@/app/_data/loaders", () => loaders);
vi.mock("../../stock/_components/PrintExportButton", () => ({ PrintExportButton: () => <button type="button">EXPORT</button> }));
const inv = vi.hoisted(() => ({ getInventoryLedger: vi.fn() }));
vi.mock("../_data", () => inv);
const ledger = vi.hoisted(() => ({ getInventoryLedgerSource: vi.fn() }));
vi.mock("../_dataLedger", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_dataLedger")>()), ...ledger }));

const { default: Page } = await import("./page");

const row = (id: string, type: string, qtyIn: number, qtyOut: number, over: object = {}) => ({
  id, movementId: `m-${id}`, movementType: type, itemId: "aaaaaaaa-0000-4000-8000-000000000001", storeId: "s1",
  qtyIn, qtyOut, balanceQty: 70, rateMinor: "25000", valueMinor: "750000", reasonCode: null, postingDate: "2026-11-12",
  itemName: "A4 Paper", itemSku: "A4", refNo: "OPEN-1", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  ledger.getInventoryLedgerSource.mockResolvedValue({ source: "api", data: "inventory" });
});

describe("Stock Movements Summary on the inventory ledger", () => {
  it("summarises inventory-service movements and never calls stock-service", async () => {
    inv.getInventoryLedger.mockResolvedValue({ source: "api", data: [row("1", "receipt", 100, 0), row("2", "issue", 0, 30)] });
    render(await Page({}));
    expect(inv.getInventoryLedger).toHaveBeenCalled();
    expect(loaders.getStockLedger).not.toHaveBeenCalled();
    expect(loaders.getStockItems).not.toHaveBeenCalled();
    expect(screen.getByText("Total In (Qty)").parentElement).toHaveTextContent("100");
    expect(screen.getByText("Total Out (Qty)").parentElement).toHaveTextContent("30");
    expect(screen.getByText("Net Movement (Qty)").parentElement).toHaveTextContent("70");
    expect(screen.getAllByText("A4 Paper").length).toBeGreaterThan(0);
  });

  it("passes the date filter through", async () => {
    inv.getInventoryLedger.mockResolvedValue({ source: "api", data: [] });
    render(await Page({ searchParams: Promise.resolve({ from: "2026-11-01", to: "2026-11-30" }) }));
    expect(inv.getInventoryLedger).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-30" });
    expect(screen.getByText("No stock movements in this period")).toBeInTheDocument();
  });

  it("an empty ledger points at New stock entry; a failed read is a load failure, not zeros", async () => {
    inv.getInventoryLedger.mockResolvedValue({ source: "api", data: [] });
    const first = render(await Page({}));
    expect(screen.getByText(/under New stock entry/)).toBeInTheDocument();
    first.unmount();
    inv.getInventoryLedger.mockResolvedValue({ source: "error", data: [], status: 500 });
    render(await Page({}));
    expect(screen.queryByText("Total In (Qty)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("stock mode is unchanged: reads the stock-service ledger", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ source: "api", data: "stock" });
    loaders.getStockLedger.mockResolvedValue({ source: "api", data: [] });
    loaders.getStockItems.mockResolvedValue({ source: "api", data: [] });
    render(await Page({}));
    expect(loaders.getStockLedger).toHaveBeenCalled();
    expect(inv.getInventoryLedger).not.toHaveBeenCalled();
  });
});
