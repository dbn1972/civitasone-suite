import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaderMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getAssetMaintenance: () => loaderMock() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import AssetMaintenancePage from "./page";

const REC = {
  id: "w1", assetId: "a1", assetCode: "DG-062", assetName: "Diesel Generator", maintenanceType: "breakdown",
  scheduledDate: "2026-10-05", estimatedCost: 0, actualCost: 0, status: "scheduled",
};

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
