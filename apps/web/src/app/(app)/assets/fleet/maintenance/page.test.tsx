import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FleetMaintenancePage from "./page";

describe("FleetMaintenancePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of maintenance jobs", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        {
          id: "m1",
          vehicleId: "11111111-1111-1111-1111-111111111111",
          type: "oil_change",
          scheduledDate: "2026-09-01",
          odometerThresholdKm: 5000,
          status: "scheduled",
        },
      ],
      source: "api",
    });

    const ui = await FleetMaintenancePage();
    render(ui);

    expect(screen.getByText("11111111-1111-1111-1111-111111111111")).toBeInTheDocument();
  });

  it("renders an empty state when there are no maintenance jobs", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await FleetMaintenancePage();
    render(ui);

    expect(screen.getByText("No maintenance scheduled yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await FleetMaintenancePage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
