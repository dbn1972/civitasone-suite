import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getVehiclesMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getVehicles: () => getVehiclesMock(),
}));

import VehiclesPage from "./page";

const UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}/i;

function vehicle(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    vehicleNo: "DL 01 CA 1234",
    make: "Toyota",
    model: "Innova",
    type: "other",
    assignedTo: UUID,
    assignedToName: "A. Kumar",
    fuelType: "diesel",
    status: "in_use",
    odometerKm: 54210,
    ...over,
  };
}

describe("VehiclesPage", () => {
  beforeEach(() => getVehiclesMock.mockReset());

  it("GAP-ESTAB-VEHICLES-02: shows the officer name, never the raw UUID, in Allocated to", async () => {
    getVehiclesMock.mockResolvedValue({ data: [vehicle()], source: "api" });
    render(await VehiclesPage());
    expect(screen.getByText("A. Kumar")).toBeInTheDocument();
    // No cell exposes a UUID.
    expect(screen.queryByText(UUID_RE)).toBeNull();
  });

  it("GAP-ESTAB-VEHICLES-02: falls back to — (not the UUID) when the name is unresolved", async () => {
    getVehiclesMock.mockResolvedValue({ data: [vehicle({ assignedToName: undefined })], source: "api" });
    render(await VehiclesPage());
    expect(screen.queryByText(UUID_RE)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("GAP-ESTAB-VEHICLES-02: shows Pool for an unallocated vehicle", async () => {
    getVehiclesMock.mockResolvedValue({ data: [vehicle({ assignedTo: undefined, assignedToName: undefined })], source: "api" });
    render(await VehiclesPage());
    // "Pool" appears both as a Segmented filter option and as the cell value.
    expect(screen.getAllByText("Pool").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(UUID_RE)).toBeNull();
  });

  it("GAP-ESTAB-VEHICLES-01: the banner links to existing Asset-register routes", async () => {
    getVehiclesMock.mockResolvedValue({ data: [vehicle()], source: "api" });
    render(await VehiclesPage());
    const assetLink = screen.getByRole("link", { name: /Asset register/i });
    expect(assetLink.getAttribute("href")).toBe("/assets/fleet/vehicles");
    const maint = screen.getByRole("link", { name: /maintenance history/i });
    expect(maint.getAttribute("href")).toBe("/assets/fleet/maintenance");
  });

  it("GAP-ESTAB-VEHICLES-03: renders exactly one 'Vehicle fleet' heading", async () => {
    getVehiclesMock.mockResolvedValue({ data: [vehicle()], source: "api" });
    render(await VehiclesPage());
    expect(screen.getAllByRole("heading", { name: "Vehicle fleet" }).length).toBe(1);
  });

  it("GAP-ESTAB-VEHICLES-04: adds an Other tile so tiles reconcile to Fleet", async () => {
    getVehiclesMock.mockResolvedValue({
      data: [
        vehicle({ id: "a", status: "available" }),
        vehicle({ id: "b", status: "retired" }),
      ],
      source: "api",
    });
    render(await VehiclesPage());
    expect(screen.getByText("Other / Retired")).toBeInTheDocument();
  });

  it("GAP-ESTAB-VEHICLES-NEW-01: renders — for a missing odometer instead of throwing", async () => {
    getVehiclesMock.mockResolvedValue({ data: [vehicle({ odometerKm: undefined })], source: "api" });
    render(await VehiclesPage());
    expect(screen.getByText("A. Kumar")).toBeInTheDocument();
  });

  it("shows — stats and a retry on error, never fabricated 0s", async () => {
    getVehiclesMock.mockResolvedValue({ data: [], source: "error" });
    render(await VehiclesPage());
    expect(screen.getAllByText("—").length).toBe(4);
  });
});
