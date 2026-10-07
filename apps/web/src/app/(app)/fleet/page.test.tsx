import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FleetDashboardPage from "./page";

const STATS = { totalVehicles: 1234, availableVehicles: 1000, scheduledMaintenance: 12, overdueMaintenance: 0 };

describe("FleetDashboardPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // GAP-FLEET-HOME-01: a failed fetch must NOT render confident zeros for a
  // safety-relevant overdue count; it must show a retryable error state.
  it("shows a retryable error state and no '0' KPI on a failed load", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { totalVehicles: 0, availableVehicles: 0, scheduledMaintenance: 0, overdueMaintenance: 0 },
      source: "error",
      status: 500,
    });
    render(await FleetDashboardPage());
    expect(screen.getByText(/Could not load fleet figures/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Overdue Maintenance")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  // GAP-FLEET-HOME-01: a genuine zero on a successful load still renders 0.
  it("renders a real 0 overdue count on a successful load", async () => {
    fetchJsonMock.mockResolvedValue({ data: STATS, source: "api" });
    render(await FleetDashboardPage());
    expect(screen.getByText("Overdue Maintenance")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // GAP-FLEET-HOME-02: counts are formatted with en-IN grouping and the
  // maintenance KPIs link to the filtered list.
  it("formats counts with en-IN grouping and links the maintenance KPIs", async () => {
    fetchJsonMock.mockResolvedValue({ data: STATS, source: "api" });
    render(await FleetDashboardPage());
    expect(screen.getByText("1,234")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /maintenance/i });
    expect(links.some((a) => a.getAttribute("href") === "/assets/fleet/maintenance")).toBe(true);
  });
});
