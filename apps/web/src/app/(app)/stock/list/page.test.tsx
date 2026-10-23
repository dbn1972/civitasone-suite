import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../_data/loaders", () => ({
  getStockItems: vi.fn(async () => ({ data: [], source: "api" })),
}));
vi.mock("../../../_components/DataSourceBadge", () => ({ DataSourceBadge: () => null }));
vi.mock("../../../_components/PrintExportButton", () => ({ PrintExportButton: () => null }));
vi.mock("./StockListClient", () => ({ StockListClient: () => <div data-testid="stock-list" /> }));

import StockListPage from "./page";
import { getStockItems } from "../../../_data/loaders";

const mockGetItems = vi.mocked(getStockItems);

describe("GAP-STOCK-LIST-05: status filter param is forwarded to the loader", () => {
  it("passes status=low from searchParams to getStockItems", async () => {
    mockGetItems.mockResolvedValueOnce({ data: [], source: "api" });
    await StockListPage({ searchParams: Promise.resolve({ status: "low" }) });
    expect(mockGetItems).toHaveBeenCalledWith(expect.objectContaining({ status: "low" }));
  });

  it("calls without status when searchParams is empty", async () => {
    mockGetItems.mockResolvedValueOnce({ data: [], source: "api" });
    await StockListPage({ searchParams: Promise.resolve({}) });
    expect(mockGetItems).toHaveBeenCalledWith({});
  });
});

describe("GAP-STOCK-LIST-05: KPI label includes (this page) when result is at service max (200)", () => {
  it("appends (this page) to SKUs label when items.length >= 200", async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `id${i}`, itemCode: `C${i}`, name: `Item ${i}`,
      category: "X", unit: "EA", currentStock: 10, isLowStock: false,
      stockStatus: "ok" as const, totalValue: 0,
    }));
    mockGetItems.mockResolvedValueOnce({ data: items as never, source: "api" });
    const page = await StockListPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page as never);
    expect(html).toContain("this page");
  });
});
