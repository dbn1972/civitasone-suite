import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ScheduleMaintenanceForm } from "./ScheduleMaintenanceForm";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const OPTS = [{ id: VALID_UUID, label: "DL01AB1234 — Tata Sumo" }];
const FUTURE_DATE = "2099-01-15";

describe("ScheduleMaintenanceForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("rejects a scheduled date in the past", () => {
    render(<ScheduleMaintenanceForm options={OPTS} />);
    fireEvent.change(screen.getByLabelText(/^Vehicle/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Scheduled Date/), { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule Maintenance" }));

    expect(screen.getByText("Scheduled date cannot be in the past.")).toBeInTheDocument();
  });

  it("schedules maintenance on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "sched-1", status: "scheduled" } }), { status: 202 }),
    );

    render(<ScheduleMaintenanceForm options={OPTS} />);
    fireEvent.change(screen.getByLabelText(/^Vehicle/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Scheduled Date/), { target: { value: FUTURE_DATE } });

    fireEvent.click(screen.getByRole("button", { name: "Schedule Maintenance" }));

    await waitFor(() => expect(screen.getByText("Schedule this maintenance job?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Schedule maintenance"));

    await waitFor(() => {
      expect(screen.getByText("Maintenance scheduled for DL01AB1234 — Tata Sumo.")).toBeInTheDocument();
    });
    expect(screen.queryByText(/sched-1/)).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe message on the confirm dialog, never a raw status code (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<ScheduleMaintenanceForm options={OPTS} />);
    fireEvent.change(screen.getByLabelText(/^Vehicle/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Scheduled Date/), { target: { value: FUTURE_DATE } });

    fireEvent.click(screen.getByRole("button", { name: "Schedule Maintenance" }));
    await waitFor(() => expect(screen.getByText("Schedule this maintenance job?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Schedule maintenance"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-ASSETS-FLEET-MAINTENANCE-02
  it("picks the vehicle from a dropdown and names it by registration in the confirm dialog", async () => {
    render(<ScheduleMaintenanceForm options={OPTS} />);
    expect((screen.getByLabelText(/^Vehicle/) as HTMLElement).tagName).toBe("SELECT");
    fireEvent.change(screen.getByLabelText(/^Vehicle/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Scheduled Date/), { target: { value: FUTURE_DATE } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule Maintenance" }));
    await waitFor(() => expect(screen.getByText("Schedule this maintenance job?")).toBeInTheDocument());
    expect(screen.getAllByText("DL01AB1234 — Tata Sumo").length).toBeGreaterThan(0);
    expect(screen.queryByText(VALID_UUID)).not.toBeInTheDocument();
  });

  it("requires a vehicle selection", () => {
    render(<ScheduleMaintenanceForm options={OPTS} />);
    fireEvent.change(screen.getByLabelText(/^Scheduled Date/), { target: { value: FUTURE_DATE } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule Maintenance" }));
    expect(screen.getByText("Select a vehicle.")).toBeInTheDocument();
  });

  it("disables the picker when there are no vehicles", () => {
    render(<ScheduleMaintenanceForm options={[]} />);
    expect(screen.getByLabelText(/^Vehicle/)).toBeDisabled();
  });

  // GAP-ASSETS-FLEET-MAINTENANCE-06
  it("explains the optional odometer threshold and links the help text to the field", () => {
    render(<ScheduleMaintenanceForm options={[]} />);
    const field = screen.getByLabelText(/^Odometer Threshold \(km\) \(optional\)/);
    const help = screen.getByText(/does not trigger it/);
    expect(field.getAttribute("aria-describedby")).toContain(help.id);
  });
});
