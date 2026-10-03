import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAssetDashboardMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getAssetDashboard: () => getAssetDashboardMock(),
}));

import AssetDashboardPage from "./page";
import { formatMoney } from "@/lib/formatters";

const ZERO = {
  totalAssets: 0, fixedAssets: 0, infraAssets: 0, underMaintenance: 0,
  dueForDisposal: 0, taggedAssets: 0, netBlock: "0", recentGrnAssets: [],
};

describe("AssetDashboardPage (GAP-ASSETS-DASHBOARD-01)", () => {
  beforeEach(() => { getAssetDashboardMock.mockReset(); });

  it("shows — on every stat tile, not fabricated zeros, when the fetch failed", async () => {
    getAssetDashboardMock.mockResolvedValue({ data: ZERO, source: "error" });
    render(await AssetDashboardPage());
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(7);
  });

  it("still renders genuine zero counts when the API answered", async () => {
    getAssetDashboardMock.mockResolvedValue({ data: ZERO, source: "api" });
    render(await AssetDashboardPage());
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryAllByText("—")).toHaveLength(0);
  });

  // GAP-ASSETS-DASHBOARD-02
  it("makes the count tiles drill-down links to the screens that list those assets", async () => {
    getAssetDashboardMock.mockResolvedValue({ data: { ...ZERO, infraAssets: 7, underMaintenance: 2, dueForDisposal: 3 }, source: "api" });
    render(await AssetDashboardPage());
    const hrefOf = (label: string) => screen.getByText(label).closest("a")?.getAttribute("href");
    expect(hrefOf("Under Maintenance")).toBe("/assets/maintenance");
    expect(hrefOf("Due Disposal")).toBe("/assets/condemnation");
    expect(hrefOf("Fixed Assets")).toBe("/assets/fixed-assets");
    expect(hrefOf("Infrastructure")).toBe("/assets/infra");
    expect(screen.getByText("Infrastructure").closest("a")).toHaveTextContent("7");
    expect(screen.getByRole("link", { name: /Condemnation & auction/ })).toHaveAttribute("href", "/assets/condemnation");
  });

  // GAP-ASSETS-DASHBOARD-03
  it("renders a bigint-safe net book value exactly and a malformed one as —", async () => {
    getAssetDashboardMock.mockResolvedValue({ data: { ...ZERO, netBlock: "9000000000000001" }, source: "api" });
    const { unmount } = render(await AssetDashboardPage());
    const exact = formatMoney("9000000000000001");
    expect(exact).toMatch(/\.01$/);
    expect(screen.getByText(exact)).toBeInTheDocument();
    unmount();
    getAssetDashboardMock.mockResolvedValue({ data: { ...ZERO, netBlock: null }, source: "api" });
    render(await AssetDashboardPage());
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  // GAP-ASSETS-DASHBOARD-05
  it("states how Due Disposal and Tagged are computed", async () => {
    getAssetDashboardMock.mockResolvedValue({ data: ZERO, source: "api" });
    render(await AssetDashboardPage());
    expect(screen.getByText("Due Disposal").closest("a")).toHaveAttribute("title", expect.stringMatching(/condemned assets awaiting auction/));
    expect(screen.getByText("Tagged").closest(".stat")).toHaveAttribute("title", expect.stringMatching(/barcode/));
  });

  // GAP-ASSETS-DASHBOARD-04
  it("uses theme tone tokens for the icon tiles, not hard-coded hex", async () => {
    getAssetDashboardMock.mockResolvedValue({ data: ZERO, source: "api" });
    const { container } = render(await AssetDashboardPage());
    const bgs = Array.from(container.querySelectorAll(".stat .ic")).map((e) => (e as HTMLElement).style.background);
    expect(bgs.length).toBe(7);
    expect(bgs.every((b) => b.includes("var(--"))).toBe(true);
  });
});
