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
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RevenueAnalyticsPage({ searchParams: {} });
    render(ui);
    expect(screen.getByText("Revenue Analytics")).toBeInTheDocument();
    expect(screen.getByText("2026-06")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Arrears Aging"));
    expect(screen.getByText("0–30 days")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Top Defaulters"));
    expect(screen.getByText("a-1")).toBeInTheDocument();
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

  it("never fabricates ₹0.00 / 0% stat-card figures when the efficiency read fails", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/efficiency")) return Promise.resolve({ data: null, source: "error" });
      if (path.includes("/arrears-aging")) return Promise.resolve({ data: null, source: "api" });
      if (path.includes("/defaulters")) return Promise.resolve({ data: [], source: "api" });
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
