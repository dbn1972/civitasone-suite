import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FleetDevicesPage from "./page";


const VEHICLES = [{ id: "11111111-1111-1111-1111-111111111111", registrationNo: "DL01AB1234", make: "Tata", model: "Sumo", year: 2020, fuelType: "diesel" }];
function defaultFetch() {
  fetchJsonMock.mockImplementation(async (path: string, empty: unknown) =>
    path.includes("fleet/vehicles") ? { data: VEHICLES, source: "api" } : { data: empty, source: "api" },
  );
}

describe("FleetDevicesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    defaultFetch();
  });

  it("renders the list of devices", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        {
          id: "d1",
          vehicleId: "11111111-1111-1111-1111-111111111111",
          deviceImei: "123456789012345",
          protocol: "gt06",
          simIccid: "8991000000000000000",
          status: "registered",
        },
      ],
      source: "api",
    });

    const ui = await FleetDevicesPage();
    render(ui);

    expect(screen.getByText("123456789012345")).toBeInTheDocument();
    // GAP-ASSETS-FLEET-DEVICES-01: device offered by IMEI + vehicle, vehicle by registration.
    expect(screen.getByRole("option", { name: "123456789012345 — DL01AB1234 — Tata Sumo" })).toBeInTheDocument();
    expect(screen.queryByText("11111111-1111-1111-1111-111111111111")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no devices", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await FleetDevicesPage();
    render(ui);

    expect(screen.getByText("No devices registered yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await FleetDevicesPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
