import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FleetVehiclesPage, { mapVehicles } from "./page";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    registrationNo: "KA01AB1234",
    make: "Tata",
    model: "Nexon",
    year: 2022,
    fuelType: "diesel",
    status: "active",
    assignedDriverId: null,
    odometerKm: 12345,
    ...overrides,
  };
}

describe("mapVehicles", () => {
  // GAP-FLEET-VEHICLES-02: a missing status is NOT silently "Active".
  it("maps a missing status to Unknown, not Active", () => {
    const rows = mapVehicles([raw({ status: undefined })])!;
    expect(rows[0]!.statusLabel).toBe("Unknown");
    expect(rows[0]!.status).toBe("unknown");
  });

  it("maps null status to Unknown", () => {
    const rows = mapVehicles([raw({ status: null })])!;
    expect(rows[0]!.statusLabel).toBe("Unknown");
  });

  // GAP-FLEET-VEHICLES-03: odometer is formatted and surfaced.
  it("formats the odometer with en-IN grouping and a km suffix", () => {
    const rows = mapVehicles([raw({ odometerKm: 123456 })])!;
    expect(rows[0]!.odometer).toBe("1,23,456 km");
  });

  it("shows an em dash for a missing odometer", () => {
    const rows = mapVehicles([raw({ odometerKm: null })])!;
    expect(rows[0]!.odometer).toBe("—");
  });

  // GAP-FLEET-VEHICLES-03: an assigned vehicle shows an id tag, not just "Assigned".
  it("shows an id tag for an assigned driver and Unassigned otherwise", () => {
    const assigned = mapVehicles([raw({ assignedDriverId: "abcdef12-0000-0000-0000-000000000000" })])!;
    expect(assigned[0]!.driver).toBe("Assigned (abcdef12)");
    const none = mapVehicles([raw({ assignedDriverId: null })])!;
    expect(none[0]!.driver).toBe("Unassigned");
  });

  // GAP-FLEET-VEHICLES-04: fuel enum is humanised.
  it("humanises the fuel enum", () => {
    expect(mapVehicles([raw({ fuelType: "diesel" })])![0]!.fuelType).toBe("Diesel");
    expect(mapVehicles([raw({ fuelType: "cng" })])![0]!.fuelType).toBe("CNG");
  });

  // GAP-FLEET-VEHICLES-05: year stays a number for numeric sorting.
  it("keeps year as a number (null when absent)", () => {
    expect(mapVehicles([raw({ year: 2022 })])![0]!.year).toBe(2022);
    expect(mapVehicles([raw({ year: undefined })])![0]!.year).toBeNull();
  });
});

describe("FleetVehiclesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // GAP-FLEET-VEHICLES-01: a failed load must not read as an empty fleet.
  it("shows a retryable error state (no 'Vehicles (0)') on a failed load", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await FleetVehiclesPage());
    expect(screen.getByText(/Could not load the vehicle list/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Vehicles (0)")).not.toBeInTheDocument();
    expect(screen.queryByText(/No vehicles registered yet/i)).not.toBeInTheDocument();
  });

  // GAP-FLEET-VEHICLES-01: empty-state CTA still shows on a successful empty load.
  it("shows the count and empty-state CTA on a successful empty load", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await FleetVehiclesPage());
    expect(screen.getByText("Vehicles (0)")).toBeInTheDocument();
    expect(screen.getByText(/No vehicles registered yet/i)).toBeInTheDocument();
  });

  // GAP-FLEET-VEHICLES-04: the register button is the primary CTA, honestly labelled.
  it("labels the register action as 'Register in Assets' and styles it primary", async () => {
    fetchJsonMock.mockResolvedValue({ data: mapVehicles([raw()]), source: "api" });
    render(await FleetVehiclesPage());
    const link = screen.getByRole("link", { name: /Register in Assets/i });
    expect(link).toHaveAttribute("href", "/assets/fleet/vehicles");
    expect(link).toHaveClass("primary");
  });

  // GAP-FLEET-VEHICLES-02: In Maintenance / Decommissioned render as real pills.
  it("renders status labels for in_maintenance and decommissioned vehicles", async () => {
    fetchJsonMock.mockResolvedValue({
      data: mapVehicles([
        raw({ id: "a", registrationNo: "KA01AB0001", status: "in_maintenance" }),
        raw({ id: "b", registrationNo: "KA01AB0002", status: "decommissioned" }),
      ]),
      source: "api",
    });
    render(await FleetVehiclesPage());
    expect(screen.getByText("In Maintenance")).toBeInTheDocument();
    expect(screen.getByText("Decommissioned")).toBeInTheDocument();
  });
});
