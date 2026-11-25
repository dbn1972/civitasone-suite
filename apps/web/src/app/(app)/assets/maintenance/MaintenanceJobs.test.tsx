import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderIntl } from "../testIntl";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { MaintenanceJobs, type MaintenanceJobRow } from "./MaintenanceJobs";

const OPEN: MaintenanceJobRow = {
  id: "11111111-1111-4111-8111-111111111111", assetId: "22222222-2222-4222-8222-222222222222",
  assetCode: "AST-0142", assetName: "Water pump, Ward 7", maintenanceType: "Preventive",
  scheduledDate: "12 Nov 2026", vendor: "Kumar Pumps & Motors", status: "scheduled", journal: "—",
};
const DONE: MaintenanceJobRow = { ...OPEN, id: "33333333-3333-4333-8333-333333333333", assetCode: "AST-0200", status: "completed" };

describe("MaintenanceJobs (UAT W4)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("shows no actions without the asset write role", () => {
    renderIntl(<MaintenanceJobs rows={[OPEN]} canAct={false} />);
    expect(screen.queryByRole("button", { name: /Complete/ })).toBeNull();
  });

  it("offers Complete only on open jobs, Meter reading on all", () => {
    renderIntl(<MaintenanceJobs rows={[OPEN, DONE]} canAct />);
    expect(screen.getAllByRole("button", { name: /Complete Preventive job/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Log meter reading/ })).toHaveLength(2);
  });

  it("PATCHes work-orders/:id/complete with the service body and reports submitted, not done", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: OPEN.id, status: "accepted" }), { status: 202 }));
    renderIntl(<MaintenanceJobs rows={[OPEN]} canAct />);
    fireEvent.click(screen.getByRole("button", { name: /Complete Preventive job/ }));
    fireEvent.change(await screen.findByLabelText(/Actual cost/), { target: { value: "4500.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete job" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain(`v1/asset/work-orders/${OPEN.id}/complete`);
    const init = spy.mock.calls[0]![1]!;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toMatchObject({ costMinor: 450050, currency: "INR" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(await screen.findByText(/Completion for AST-0142 submitted/)).toBeInTheDocument();
  });

  it("blocks a bad cost client-side and surfaces a service error without faking success", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "role not permitted" }), { status: 403 }));
    renderIntl(<MaintenanceJobs rows={[OPEN]} canAct />);
    fireEvent.click(screen.getByRole("button", { name: /Complete Preventive job/ }));
    fireEvent.change(await screen.findByLabelText(/Actual cost/), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete job" }));
    expect(await screen.findByText(/at most 2 decimals/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Actual cost/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete job" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("POSTs a meter reading to the asset", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    renderIntl(<MaintenanceJobs rows={[OPEN]} canAct />);
    fireEvent.click(screen.getByRole("button", { name: /Log meter reading for AST-0142/ }));
    fireEvent.change(await screen.findByLabelText(/^Reading/), { target: { value: "48210" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain(`v1/asset/assets/${OPEN.assetId}/meter-readings`);
    expect(JSON.parse(spy.mock.calls[0]![1]!.body as string)).toMatchObject({ meterType: "odometer", readingValue: 48210, unit: "km", source: "manual" });
  });

  it("renders in Hindi", () => {
    renderIntl(<MaintenanceJobs rows={[OPEN]} canAct />, "hi");
    expect(screen.getByRole("button", { name: /मीटर रीडिंग/ })).toBeInTheDocument();
  });
});
