import { describe, it, expect } from "vitest";
import { mapMaintenanceSummaries } from "./apiMappers";

describe("mapMaintenanceSummaries", () => {
  it("reads the real maintenanceType and the joined asset code/name (GAP-ASSETS-MAINTENANCE-01/-02)", () => {
    const rows = mapMaintenanceSummaries({ data: [{
      id: "w1", assetId: "11111111-2222-3333-4444-555555555555", assetCode: "DG-062", assetName: "Diesel Generator",
      maintenanceType: "breakdown", scheduledDate: "2026-10-05", status: "open",
    }] });
    expect(rows?.[0]).toMatchObject({ assetCode: "DG-062", assetName: "Diesel Generator", maintenanceType: "breakdown", status: "scheduled" });
  });

  it("falls back to corrective for a missing/unknown type and a short id label for a missing code", () => {
    const rows = mapMaintenanceSummaries({ data: [{ id: "w2", assetId: "abcdef12-0000-0000-0000-000000000000", maintenanceType: "weird", status: "open" }] });
    expect(rows?.[0]).toMatchObject({ maintenanceType: "corrective", assetCode: "ABCDEF12" });
  });
});
