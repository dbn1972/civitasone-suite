import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RevenueAnalyticsPage from "./page";

describe("RevenueAnalyticsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders trends, aging, and defaulter data", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/trends")) {
        return Promise.resolve({
          data: [{ period: "2026-06", demandMinor: "1000000", collectionMinor: "800000", efficiencyBps: 8000 }],
          source: "api",
        });
      }
      if (path.includes("/efficiency")) {
        return Promise.resolve({
          data: {
            totalDemandMinor: "1000000",
            totalCollectionMinor: "800000",
            efficiencyBps: 8000,
            perPeriod: [{ period: "2026-06", demandMinor: "1000000", collectionMinor: "800000", efficiencyBps: 8000 }],
          },
          source: "api",
        });
      }
      if (path.includes("/arrears-aging")) {
        return Promise.resolve({
          data: { bucket0_30: "50000", bucket31_60: "20000", bucket61_90: "10000", bucket90Plus: "5000" },
          source: "api",
        });
      }
      if (path.includes("/defaulters")) {
        return Promise.resolve({
          data: [{ rank: 1, assesseeId: "a-1", outstandingMinor: "70000" }],
          source: "api",
        });
      }
      if (path.includes("/assessees")) {
        return Promise.resolve({
          data: [{ id: "a-1", ownerName: "Sita Devi", identifierNo: "PROP-9" }],
          source: "api",
        });
      }
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RevenueAnalyticsPage({ searchParams: {} });
    render(ui);
    expect(screen.getByText("Revenue Analytics")).toBeInTheDocument();
    // GAP-REVENUE-ANALYTICS-05: monthly period renders as "Jun 2026", not "2026-06".
    expect(screen.getByText("Jun 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-06")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Arrears Aging"));
    expect(screen.getByText("0–30 days")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Top Defaulters"));
    // GAP-REVENUE-ANALYTICS-01: owner + identifier shown, with a link to the
    // ledger; no raw UUID / assessee-id text column.
    const ownerLink = screen.getByRole("link", { name: /Sita Devi/ });
    expect(ownerLink).toHaveAttribute("href", "/revenue/assessees/a-1");
    expect(screen.getByText("PROP-9")).toBeInTheDocument();
  });

  it("shows the top defaulter by max outstanding, not array index 0 (ANALYTICS-03)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/efficiency")) {
        return Promise.resolve({
          data: { totalDemandMinor: "0", totalCollectionMinor: "0", efficiencyBps: 0, perPeriod: [] },
          source: "api",
        });
      }
      if (path.includes("/defaulters")) {
        return Promise.resolve({
          // Deliberately unsorted: the biggest is NOT index 0.
          data: [
            { rank: 2, assesseeId: "a-1", outstandingMinor: "70000" },
            { rank: 1, assesseeId: "a-2", outstandingMinor: "250000" },
          ],
          source: "api",
        });
      }
      if (path.includes("/arrears-aging")) return Promise.resolve({ data: null, source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RevenueAnalyticsPage({ searchParams: {} });
    render(ui);
    // ₹2,500.00 (the max), not ₹700.00 (index 0).
    expect(screen.getByText("₹2,500.00")).toBeInTheDocument();
    expect(screen.queryByText("₹700.00")).not.toBeInTheDocument();
  });

  it("renders empty states when there is no analytics data", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/arrears-aging")) return Promise.resolve({ data: null, source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RevenueAnalyticsPage({ searchParams: {} });
    render(ui);
    expect(screen.getByText("No trend data")).toBeInTheDocument();
  });

  it("shows the data-source badge when any analytics endpoint errors", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/trends")) return Promise.resolve({ data: [], source: "error" });
      if (path.includes("/arrears-aging")) return Promise.resolve({ data: null, source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RevenueAnalyticsPage({ searchParams: {} });
    render(ui);
    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });

  it("shows a retry error state on the Defaulters tab when that fetch fails, not a false 'No defaulters' (ANALYTICS-02)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/defaulters")) return Promise.resolve({ data: [], source: "error" });
      if (path.includes("/arrears-aging")) return Promise.resolve({ data: null, source: "api" });
      if (path.includes("/efficiency")) {
        return Promise.resolve({
          data: { totalDemandMinor: "0", totalCollectionMinor: "0", efficiencyBps: 0, perPeriod: [] },
          source: "api",
        });
      }
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RevenueAnalyticsPage({ searchParams: {} });
    render(ui);
    fireEvent.click(screen.getByText("Top Defaulters"));
    expect(screen.queryByText("No defaulters")).not.toBeInTheDocument();
    expect(screen.getByText("We couldn't load top defaulters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // ANALYTICS-03: a failed defaulters read shows "—" for the top-defaulter stat.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a retry error state on the Trends tab when trends fail (ANALYTICS-02)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/trends")) return Promise.resolve({ data: [], source: "error" });
      if (path.includes("/arrears-aging")) return Promise.resolve({ data: null, source: "api" });
      if (path.includes("/efficiency")) {
        return Promise.resolve({
          data: { totalDemandMinor: "0", totalCollectionMinor: "0", efficiencyBps: 0, perPeriod: [] },
          source: "api",
        });
      }
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RevenueAnalyticsPage({ searchParams: {} });
    render(ui);
    expect(screen.queryByText("No trend data")).not.toBeInTheDocument();
    expect(screen.getByText("We couldn't load trend data.")).toBeInTheDocument();
  });

  it("never fabricates ₹0.00 / 0% stat-card figures when the efficiency read fails", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/efficiency")) return Promise.resolve({ data: null, source: "error" });
      if (path.includes("/arrears-aging")) return Promise.resolve({ data: null, source: "api" });
      // Defaulters also errored so the top-defaulter stat is "—" too; its
      // ₹0.00-when-genuinely-empty behaviour is asserted by the ANALYTICS-03 test.
      if (path.includes("/defaulters")) return Promise.resolve({ data: [], source: "error" });
      if (path.includes("/trends")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RevenueAnalyticsPage({ searchParams: {} });
    render(ui);

    // The three efficiency-derived stat cards must render "—", never a fabricated
    // ₹0.00 or 0% that would be indistinguishable from a genuine zero reading.
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });
});
