import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaderMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getAssetMaintenance: () => loaderMock() }));
const rolesMock = vi.fn(() => ["asset_manager"] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
vi.mock("./MaintenanceJobs", () => ({
  MaintenanceJobs: ({ rows, canAct }: { rows: Array<{ id: string; assetName: string; maintenanceType: string; scheduledDate: string; vendor: string; status: string; assetCode: string; journal: string }>; canAct: boolean }) => (
    <table data-testid="jobs" data-can-act={String(canAct)}>
      <thead><tr><th>Asset code</th><th>Asset</th><th>Type</th><th>Scheduled</th><th>Technician / Agency</th><th>Status</th><th>Journal</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{r.assetCode}</td><td>{r.assetName}</td><td>{r.maintenanceType}</td><td>{r.scheduledDate}</td><td>{r.vendor}</td><td>{r.status}</td><td>{r.journal}</td></tr>)}</tbody>
    </table>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock("../AccountingBanner", () => ({ AccountingBanner: ({ areas }: { areas: string[] }) => <div data-testid="accounting-banner" data-areas={areas.join(",")} /> }));

import AssetMaintenancePage from "./page";

const REC = {
  id: "w1", assetId: "a1", assetCode: "DG-062", assetName: "Diesel Generator", maintenanceType: "breakdown",
  scheduledDate: "2026-10-05", estimatedCost: 0, actualCost: 0, status: "scheduled",
};

describe("AssetMaintenancePage accounting (fp-assets-02)", () => {
  beforeEach(() => loaderMock.mockReset());

  it("shows the accounting banner for the maintenance area and each job's journal state (awaiting accounts / posted / not posted)", async () => {
    loaderMock.mockResolvedValue({
      source: "api",
      data: [
        { ...REC, id: "w1", status: "completed", glPostStatus: "awaiting_accounts" },
        { ...REC, id: "w2", assetCode: "DG-2", status: "completed", glPostStatus: "posted" },
        { ...REC, id: "w3", assetCode: "DG-3", status: "completed", glPostStatus: "failed" },
        { ...REC, id: "w4", assetCode: "DG-4", status: "scheduled" },
      ],
    });
    render(await AssetMaintenancePage());
    expect(screen.getByTestId("accounting-banner")).toHaveAttribute("data-areas", "maintenance");
    expect(screen.getByRole("columnheader", { name: /Journal/ })).toBeInTheDocument();
    expect(screen.getByText("Awaiting accounts")).toBeInTheDocument();
    expect(screen.getByText("Journal posted")).toBeInTheDocument();
    expect(screen.getByText("Journal not posted")).toBeInTheDocument();
  });
});

describe("AssetMaintenancePage", () => {
  beforeEach(() => loaderMock.mockReset());

  it("Schedule and + Log Job go to different, typed destinations (GAP-ASSETS-MAINTENANCE-01)", async () => {
    loaderMock.mockResolvedValue({ data: [REC], source: "api" });
    render(await AssetMaintenancePage());
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/assets/maintenance/new?type=preventive");
    expect(screen.getByRole("link", { name: "+ Log Job" })).toHaveAttribute("href", "/assets/maintenance/new?type=breakdown");
  });

  it("has honest column headers, humanised type and no SLA promise (GAP-ASSETS-MAINTENANCE-02/-03)", async () => {
    loaderMock.mockResolvedValue({ data: [REC], source: "api" });
    render(await AssetMaintenancePage());
    expect(screen.queryByText("Job")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Asset code/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Scheduled/ })).toBeInTheDocument();
    expect(screen.getByText("DG-062")).toBeInTheDocument();
    expect(screen.getByText("Breakdown")).toBeInTheDocument();
    expect(screen.getByText("05 Oct 2026")).toBeInTheDocument();
    expect(screen.queryByText(/SLA/)).not.toBeInTheDocument();
  });
});
