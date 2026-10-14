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
