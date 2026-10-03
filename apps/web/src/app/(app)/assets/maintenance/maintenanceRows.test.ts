import { describe, it, expect } from "vitest";
import type { MaintenanceSummary } from "@civitasone/types";
import { buildMaintenanceRows, countByType } from "./maintenanceRows";

const base: MaintenanceSummary = {
  id: "w1", assetId: "a1", assetCode: "DG-062", assetName: "Diesel Generator", maintenanceType: "breakdown",
  scheduledDate: "2026-10-05", estimatedCost: 0, actualCost: 0, status: "in_progress",
};

describe("buildMaintenanceRows", () => {
  it("humanises the type, formats the date and keeps the raw status for the pill (GAP-ASSETS-MAINTENANCE-02/-03)", () => {
    const [row] = buildMaintenanceRows([base]);
    expect(row).toMatchObject({ assetCode: "DG-062", maintenanceType: "Breakdown", scheduledDate: "05 Oct 2026", status: "in_progress", vendor: "—" });
  });

  it("carries the journal state through the supplied labeller (unknown state reads as none)", () => {
    const label = (s: string) => `L:${s}`;
    expect(buildMaintenanceRows([{ ...base, glPostStatus: "awaiting_accounts" }], label)[0]?.journal).toBe("L:awaiting_accounts");
    expect(buildMaintenanceRows([{ ...base, glPostStatus: "bogus" }], label)[0]?.journal).toBe("L:none");
    expect(buildMaintenanceRows([base], label)[0]?.journal).toBe("L:none");
  });

  it("shows a dash when the date is unknown", () => {
    expect(buildMaintenanceRows([{ ...base, scheduledDate: "—" }])[0]?.scheduledDate).toBe("—");
  });

  it("counts by real type", () => {
    const list = [base, { ...base, id: "w2", maintenanceType: "preventive" as const }, { ...base, id: "w3", maintenanceType: "preventive" as const }];
    expect(countByType(list, "preventive")).toBe(2);
    expect(countByType(list, "breakdown")).toBe(1);
  });
});
