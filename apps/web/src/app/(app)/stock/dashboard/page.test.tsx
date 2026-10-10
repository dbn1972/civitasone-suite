import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({
  getStockDashboard: vi.fn(),
  getStockLedger: vi.fn(),
}));
vi.mock("../../../_components/DataSourceBadge", () => ({ DataSourceBadge: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import Page from "./page";
import { getStockDashboard, getStockLedger } from "../../../_data/loaders";

const dash = vi.mocked(getStockDashboard);
const ledger = vi.mocked(getStockLedger);

const HEALTHY = {
  // GAP2-STOCK-DASHBOARD-01: inventoryValue is a bigint-paise string.
  data: { totalSKUs: 128, lowStockAlerts: 4, stockOuts: 2, grnsThisMonth: 5, inventoryValue: "500000" },
  source: "api" as const,
};

beforeEach(() => {
  dash.mockReset();
  ledger.mockReset();
  ledger.mockResolvedValue({ data: [], source: "api" });
});

describe("Stock Dashboard page", () => {
  // GAP-STOCK-DASHBOARD-01: fabricated trend deltas must not appear.
  it("GAP-STOCK-DASHBOARD-01: never renders the fabricated +120 / +1.8% deltas", async () => {
    dash.mockResolvedValue(HEALTHY);
    render(await Page());
    expect(screen.queryByText("+120")).not.toBeInTheDocument();
    expect(screen.queryByText("+1.8%")).not.toBeInTheDocument();
  });

  // GAP-STOCK-DASHBOARD-02: error state shows "—" and a retry, not fabricated zeros.
  it("GAP-STOCK-DASHBOARD-02: on error shows '—' (no 0 / ₹0.00) and a retry state", async () => {
    dash.mockResolvedValue({ data: HEALTHY.data, source: "error", status: 500 });
    render(await Page());
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    // GRN count pill is hidden on error (no contradictory signal)
    expect(screen.queryByText("5")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("GAP-STOCK-DASHBOARD-02: healthy payload shows real figures", async () => {
    dash.mockResolvedValue(HEALTHY);
    render(await Page());
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument();
  });

  // GAP-STOCK-DASHBOARD-03: movements render from the ledger; GRN card is not self-contradictory.
  it("GAP-STOCK-DASHBOARD-03: recent ledger movements render in the Stock Movements card", async () => {
    dash.mockResolvedValue(HEALTHY);
    ledger.mockResolvedValue({
      data: [
        { id: "l1", itemCode: "A1", itemName: "Bolts", date: "2026-09-01", type: "receipt", quantity: 10, direction: "in", signedQuantity: 10, unitCost: 100, totalValue: 1000, balance: 10 },
      ],
      source: "api",
    });
    render(await Page());
    expect(screen.getByText("Bolts")).toBeInTheDocument();
    expect(screen.queryByText("No recent movements")).not.toBeInTheDocument();
  });

  it("GAP-STOCK-DASHBOARD-03: grnsThisMonth=5 does not say 'No recent GRNs'", async () => {
    dash.mockResolvedValue(HEALTHY);
    render(await Page());
    expect(screen.queryByText("No recent GRNs")).not.toBeInTheDocument();
    // links out to the real GRN screen
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/procurement/grn");
  });

  // GAP-STOCK-DASHBOARD-04: Stock-outs shows a real number, not a static "—".
  it("GAP-STOCK-DASHBOARD-04: Stock-outs reflects the real stockOuts figure", async () => {
    dash.mockResolvedValue(HEALTHY);
    render(await Page());
    expect(screen.getByText("Stock-outs")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  // GAP-STOCK-DASHBOARD-05: the primary action is "+ New Entry" and points at the ledger form.
  it("GAP-STOCK-DASHBOARD-05: button reads '+ New Entry' and links to /stock/ledger/new", async () => {
    dash.mockResolvedValue(HEALTHY);
    render(await Page());
    const link = screen.getByRole("link", { name: "+ New Entry" });
    expect(link).toHaveAttribute("href", "/stock/ledger/new");
  });

  it("GAP-STOCK-DASHBOARD-05: Low Stock stat links to /inventory/low-stock", async () => {
    dash.mockResolvedValue(HEALTHY);
    render(await Page());
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/inventory/low-stock");
  });

  // GAP-STOCK-DASHBOARD-07: the export action is honestly labelled "Print".
  it("GAP-STOCK-DASHBOARD-07: header action is labelled 'Print' (not 'Export')", async () => {
    dash.mockResolvedValue(HEALTHY);
    render(await Page());
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^export$/i })).not.toBeInTheDocument();
  });

  // GAP-STOCK-DASHBOARD-08: client-side nav links (next/link), not raw full-reload anchors.
  it("GAP-STOCK-DASHBOARD-08: uses Link for navigation (mocked to <a>)", async () => {
    dash.mockResolvedValue(HEALTHY);
    render(await Page());
    // The full-ledger link exists via Link
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/stock/ledger");
  });
});
