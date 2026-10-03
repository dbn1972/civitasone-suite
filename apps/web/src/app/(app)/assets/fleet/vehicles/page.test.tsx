import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FleetVehiclesPage from "./page";

describe("FleetVehiclesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  // GAP-ASSETS-FLEET-VEHICLES-01
  it("offers a per-row Record GPS action that preselects the vehicle", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "11111111-1111-1111-1111-111111111111", registrationNo: "DL01AB1234", make: "Tata", model: "Sumo", year: 2020, fuelType: "diesel" }],
      source: "api",
    });
    render(await FleetVehiclesPage({ searchParams: { vehicleId: "11111111-1111-1111-1111-111111111111" } }));
    expect(screen.getByRole("link", { name: "Record GPS for DL01AB1234" })).toHaveAttribute(
      "href",
      "/assets/fleet/vehicles?vehicleId=11111111-1111-1111-1111-111111111111#record-gps",
    );
    expect((screen.getByLabelText(/^Vehicle/) as HTMLSelectElement).value).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("renders the list of vehicles", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        {
          id: "v1",
          registrationNo: "DL01AB1234",
          make: "Tata",
          model: "Nexon",
          year: 2023,
          fuelType: "electric",
          status: "active",
        },
      ],
      source: "api",
    });

    const ui = await FleetVehiclesPage({});
    render(ui);

    expect(screen.getByText("DL01AB1234")).toBeInTheDocument();
  });

  it("renders an empty state when there are no vehicles", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await FleetVehiclesPage({});
    render(ui);

    expect(screen.getByText("No vehicles registered yet")).toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-VEHICLES-03
  it("shows a load error with Retry -- not the empty state -- when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await FleetVehiclesPage({});
    render(ui);

    expect(screen.queryByText("No vehicles registered yet")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
    // the register form stays usable
    expect(screen.getByRole("button", { name: "Register Vehicle" })).toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-VEHICLES-04
  it("renders fuel types with their proper labels (CNG, not Cng)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        { id: "v1", registrationNo: "DL01AB1234", make: "Tata", model: "Nexon", year: 2023, fuelType: "cng" },
        { id: "v2", registrationNo: "DL01AB5678", make: "Tata", model: "Nexon", year: 2023, fuelType: "petrol" },
      ],
      source: "api",
    });
    render(await FleetVehiclesPage({}));
    const table = within(screen.getByRole("table"));
    expect(table.getByText("CNG")).toBeInTheDocument();
    expect(table.getByText("Petrol")).toBeInTheDocument();
    expect(screen.queryByText("Cng")).not.toBeInTheDocument();
  });
});
