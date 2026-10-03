import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const rolesMock = vi.fn<() => string[]>(() => ["fleet_manager"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

import FleetMaintenancePage from "./page";


const VEHICLES = [{ id: "11111111-1111-1111-1111-111111111111", registrationNo: "DL01AB1234", make: "Tata", model: "Sumo", year: 2020, fuelType: "diesel" }];
function defaultFetch() {
  fetchJsonMock.mockImplementation(async (path: string, empty: unknown) =>
    path.includes("fleet/vehicles") ? { data: VEHICLES, source: "api" } : { data: empty, source: "api" },
  );
}

/** Mimics fetchJson: the maintenance call goes through the page's own mapResponse. */
function mappedFetch(rows: unknown[]) {
  fetchJsonMock.mockImplementation(async (path: string, empty: unknown, opts?: { mapResponse?: (p: unknown) => unknown }) =>
    path.includes("fleet/vehicles")
      ? { data: VEHICLES, source: "api" }
      : { data: opts?.mapResponse ? (opts.mapResponse({ data: rows }) ?? empty) : rows, source: "api" },
  );
}

describe("FleetMaintenancePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["fleet_manager"]);
    defaultFetch();
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

    // GAP-ASSETS-FLEET-MAINTENANCE-02: registration, not the raw UUID.
    expect(screen.getAllByText("DL01AB1234 — Tata Sumo").length).toBeGreaterThan(0);
    expect(screen.queryByText("11111111-1111-1111-1111-111111111111")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no maintenance jobs", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await FleetMaintenancePage();
    render(ui);

    expect(screen.getByText("No maintenance scheduled yet")).toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-MAINTENANCE-03
  it("shows a load error with Retry -- not the empty state -- when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await FleetMaintenancePage();
    render(ui);

    expect(screen.queryByText("No maintenance scheduled yet")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
    // the schedule form stays visible
    expect(screen.getByRole("button", { name: "Schedule Maintenance" })).toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-MAINTENANCE-04
  it("formats the scheduled date as dd Mon yyyy in IST and shows an em dash when absent", async () => {
    mappedFetch([
      { id: "m1", vehicleId: "11111111-1111-1111-1111-111111111111", type: "oil_change", scheduledDate: "2026-10-05T00:00:00.000Z", status: "completed" },
      { id: "m2", vehicleId: "11111111-1111-1111-1111-111111111111", type: "full_service", scheduledDate: "", status: "completed" },
    ]);
    render(await FleetMaintenancePage());
    expect(screen.getByText("05 Oct 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-10-05T00:00:00.000Z")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  // GAP-ASSETS-FLEET-MAINTENANCE-05
  it("flags a scheduled job whose date has passed as overdue, and only open jobs get actions", async () => {
    mappedFetch([
      { id: "m1", vehicleId: "11111111-1111-1111-1111-111111111111", type: "oil_change", scheduledDate: "2020-01-01", status: "scheduled" },
      { id: "m2", vehicleId: "11111111-1111-1111-1111-111111111111", type: "full_service", scheduledDate: "2099-01-01", status: "scheduled" },
      { id: "m3", vehicleId: "11111111-1111-1111-1111-111111111111", type: "battery_check", scheduledDate: "2020-01-01", status: "completed" },
    ]);
    render(await FleetMaintenancePage());
    expect(screen.getAllByText("Overdue")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Mark .* as done$/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Cancel / })).toHaveLength(2);
  });

  it("hides the Mark done / Cancel actions from a read-only role", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    mappedFetch([{ id: "m1", vehicleId: "11111111-1111-1111-1111-111111111111", type: "oil_change", scheduledDate: "2020-01-01", status: "scheduled" }]);
    render(await FleetMaintenancePage());
    expect(screen.queryByRole("button", { name: /Mark .* as done/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
  });
});
