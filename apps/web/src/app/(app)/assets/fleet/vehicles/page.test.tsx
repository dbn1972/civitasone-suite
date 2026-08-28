import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

    const ui = await FleetVehiclesPage();
    render(ui);

    expect(screen.getByText("DL01AB1234")).toBeInTheDocument();
  });

  it("renders an empty state when there are no vehicles", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await FleetVehiclesPage();
    render(ui);

    expect(screen.getByText("No vehicles registered yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await FleetVehiclesPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
