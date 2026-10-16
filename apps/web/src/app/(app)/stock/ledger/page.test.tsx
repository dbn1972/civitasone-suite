import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../_data/loaders", () => ({
  getStockLedger: vi.fn(async () => ({ data: [], source: "error" })),
}));
vi.mock("../_components/PrintExportButton", () => ({ PrintExportButton: () => null }));
vi.mock("./StockLedgerClient", () => ({ StockLedgerClient: () => "No ledger entries" }));

import StockLedgerPage from "./page";

describe("GAP-STOCK-LEDGER-01: failed ledger load", () => {
  it("shows an error state and no zero totals", async () => {
    const html = renderToStaticMarkup(await StockLedgerPage());
    expect(html).not.toContain("No ledger entries");
    expect(html).not.toMatch(/0\.00/);
    expect(html).toContain("—");
  });
});

describe("GAP-STOCK-LEDGER-05: ledger KPI and column labels are unambiguous", () => {
  it("renders Net Receipts − Issues label (not Net Balance) in the healthy path", async () => {
    const { getStockLedger } = await import("../../../_data/loaders");
    (getStockLedger as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [{ id: "e1", itemCode: "X", itemName: "Y", date: "2026-01-01", type: "receipt", quantity: 1, direction: "in", signedQuantity: 1, unitCost: 100, totalValue: 100, balance: 1 }],
      source: "api",
    });
    const html = renderToStaticMarkup(await StockLedgerPage());
    expect(html).toContain("Net Receipts");
    expect(html).not.toContain(">Net Balance<");
  });
});
