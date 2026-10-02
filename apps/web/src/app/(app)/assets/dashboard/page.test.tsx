import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAssetDashboardMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getAssetDashboard: () => getAssetDashboardMock(),
}));

import AssetDashboardPage from "./page";

const ZERO = {
  totalAssets: 0, fixedAssets: 0, infraAssets: 0, underMaintenance: 0,
  dueForDisposal: 0, taggedAssets: 0, netBlock: 0, recentGrnAssets: [],
};

describe("AssetDashboardPage (GAP-ASSETS-DASHBOARD-01)", () => {
  beforeEach(() => { getAssetDashboardMock.mockReset(); });

  it("shows — on every stat tile, not fabricated zeros, when the fetch failed", async () => {
    getAssetDashboardMock.mockResolvedValue({ data: ZERO, source: "error" });
    render(await AssetDashboardPage());
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(6);
  });

  it("still renders genuine zero counts when the API answered", async () => {
    getAssetDashboardMock.mockResolvedValue({ data: ZERO, source: "api" });
    render(await AssetDashboardPage());
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryAllByText("—")).toHaveLength(0);
  });
});
