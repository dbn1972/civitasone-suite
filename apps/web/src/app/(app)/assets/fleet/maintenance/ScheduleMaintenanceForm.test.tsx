import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ScheduleMaintenanceForm } from "./ScheduleMaintenanceForm";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const FUTURE_DATE = "2099-01-15";

describe("ScheduleMaintenanceForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("rejects a scheduled date in the past", () => {
    render(<ScheduleMaintenanceForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Scheduled Date/), { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule Maintenance" }));

    expect(screen.getByText("Scheduled date cannot be in the past.")).toBeInTheDocument();
  });

  it("schedules maintenance on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "sched-1", status: "scheduled" } }), { status: 202 }),
    );

    render(<ScheduleMaintenanceForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Scheduled Date/), { target: { value: FUTURE_DATE } });

    fireEvent.click(screen.getByRole("button", { name: "Schedule Maintenance" }));

    await waitFor(() => expect(screen.getByText("Schedule this maintenance job?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Schedule maintenance"));

    await waitFor(() => {
      expect(screen.getByText(/Maintenance scheduled/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<ScheduleMaintenanceForm />);
    fireEvent.change(screen.getByLabelText(/^Vehicle ID/), { target: { value: VALID_UUID } });
    fireEvent.change(screen.getByLabelText(/^Scheduled Date/), { target: { value: FUTURE_DATE } });

    fireEvent.click(screen.getByRole("button", { name: "Schedule Maintenance" }));
    await waitFor(() => expect(screen.getByText("Schedule this maintenance job?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Schedule maintenance"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
