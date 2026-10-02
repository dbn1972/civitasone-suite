import { describe, it, expect } from "vitest";
import { parseAssetIdParam, parseMaintenanceType, validateScheduledDate, pageTitleFor } from "./workOrderForm";

describe("work order form helpers", () => {
  it("parses ?type= with breakdown as the safe default", () => {
    expect(parseMaintenanceType("preventive")).toBe("preventive");
    expect(parseMaintenanceType("nonsense")).toBe("breakdown");
    expect(parseMaintenanceType(null)).toBe("breakdown");
  });

  it("only trusts a real uuid for ?assetId=", () => {
    expect(parseAssetIdParam("11111111-2222-3333-4444-555555555555")).toBe("11111111-2222-3333-4444-555555555555");
    expect(parseAssetIdParam("../etc")).toBeNull();
    expect(parseAssetIdParam(null)).toBeNull();
  });

  it("blocks a past date for scheduled (preventive) work but allows it when logging a breakdown (GAP-ASSETS-MAINTENANCE-NEW-03)", () => {
    expect(validateScheduledDate("preventive", "2026-10-01", "2026-10-03")).toMatch(/cannot be scheduled in the past/);
    expect(validateScheduledDate("preventive", "2026-10-03", "2026-10-03")).toBeNull();
    expect(validateScheduledDate("breakdown", "2026-10-01", "2026-10-03")).toBeNull();
    expect(validateScheduledDate("amc", "2026-09-01", "2026-10-03")).not.toBeNull();
    expect(validateScheduledDate("preventive", "", "2026-10-03")).toBe("Choose a valid date.");
  });

  it("the past-date policy is configurable", () => {
    expect(validateScheduledDate("breakdown", "2026-10-01", "2026-10-03", [])).not.toBeNull();
  });

  it("titles follow the type", () => {
    expect(pageTitleFor("preventive").title).toBe("Schedule Maintenance");
    expect(pageTitleFor("breakdown").title).toBe("Log Maintenance Job");
  });
});
