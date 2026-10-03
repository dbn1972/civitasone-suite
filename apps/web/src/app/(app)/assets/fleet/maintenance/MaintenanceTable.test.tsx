import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { MaintenanceTable, type MaintenanceTableRow } from "./MaintenanceTable";

const ROW: MaintenanceTableRow = {
  id: "22222222-2222-2222-2222-222222222222",
  vehicle: "DL01AB1234 — Tata Sumo",
  typeLabel: "oil change",
  scheduledLabel: "05 Oct 2026",
  odometerThresholdKm: "—",
  statusLabel: "scheduled",
  open: true,
};

describe("MaintenanceTable actions (GAP-ASSETS-FLEET-MAINTENANCE-05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("marks a job done after confirmation and refreshes", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<MaintenanceTable rows={[ROW]} canAct />);
    fireEvent.click(screen.getByRole("button", { name: /Mark oil change for .* as done/ }));
    await screen.findByRole("alertdialog");
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain(`v1/assets/fleet/maintenance/${ROW.id}/complete`);
    expect(spy.mock.calls[0]![1]!.method).toBe("PATCH");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(await screen.findByText(/as done/)).toBeInTheDocument();
  });

  it("cancel asks for confirmation and sends nothing when declined", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<MaintenanceTable rows={[ROW]} canAct />);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel oil change/ }));
    expect(await screen.findByText("Cancel this maintenance job?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep job" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("cancels the job on the cancel endpoint when confirmed", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<MaintenanceTable rows={[ROW]} canAct />);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel oil change/ }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain(`/maintenance/${ROW.id}/cancel`);
  });

  it("shows a clerk-safe error in the dialog when the service refuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "ALREADY_COMPLETED", message: "maintenance already marked as completed" }), { status: 409 }),
    );
    render(<MaintenanceTable rows={[ROW]} canAct />);
    fireEvent.click(screen.getByRole("button", { name: /Mark oil change for .* as done/ }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByText(/already been closed/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("offers no actions on closed jobs or without write access", () => {
    const { rerender } = render(<MaintenanceTable rows={[{ ...ROW, open: false, statusLabel: "completed" }]} canAct />);
    expect(screen.queryByRole("button", { name: /Mark/ })).not.toBeInTheDocument();
    rerender(<MaintenanceTable rows={[ROW]} canAct={false} />);
    expect(screen.queryByRole("button", { name: /Mark/ })).not.toBeInTheDocument();
  });
});
