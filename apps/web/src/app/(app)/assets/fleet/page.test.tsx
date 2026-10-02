import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import FleetOverviewPage from "./page";
import { mapFleetSummary } from "./_data/summary";

const SUMMARY = { totalVehicles: 12, availableVehicles: 9, scheduledMaintenance: 3, overdueMaintenance: 2 };

describe("FleetOverviewPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // GAP-ASSETS-FLEET-01
  it("shows vehicle and maintenance counts from the fleet summary", async () => {
    fetchJsonMock.mockResolvedValue({ data: SUMMARY, source: "api" });
    render(await FleetOverviewPage());
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/assets/fleet/dashboard");
  });

  it("shows an em dash -- never a misleading 0 -- when the summary fails to load", async () => {
    fetchJsonMock.mockResolvedValue({ data: { totalVehicles: 0, availableVehicles: 0, scheduledMaintenance: 0, overdueMaintenance: 0 }, source: "error" });
    render(await FleetOverviewPage());
    expect(screen.getAllByText("—").length).toBe(4);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-02
  it("titles each card exactly as its destination page", async () => {
    fetchJsonMock.mockResolvedValue({ data: SUMMARY, source: "api" });
    render(await FleetOverviewPage());
    for (const title of ["Fleet Vehicles", "Fleet IoT Devices", "Fleet Maintenance"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Open Fleet IoT Devices" })).toHaveAttribute("href", "/assets/fleet/devices");
  });

  it("maps only a well-formed summary payload", () => {
    expect(mapFleetSummary({ data: SUMMARY })).toEqual(SUMMARY);
    expect(mapFleetSummary({ data: { totalVehicles: "x" } })).toBeNull();
    expect(mapFleetSummary(null)).toBeNull();
  });
});
