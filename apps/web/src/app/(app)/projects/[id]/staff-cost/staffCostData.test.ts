import { describe, it, expect } from "vitest";
import { defaultRange, mapStaffCost } from "./staffCostData";

describe("mapStaffCost: totals only, field by field", () => {
  it("keeps only the known total fields even if the body carried more", () => {
    const m = mapStaffCost({
      projectCode: "UMANG", projectId: "p", employees: [{ employeeId: "e1", salary: "9" }], salaryByPerson: { e1: "9" },
      periods: [{ period: "2026-09", grossMinor: "100", employerCostMinor: "10", totalCostMinor: "110", headcount: 2, employeeId: "e1", pay: "100" }],
      totals: { grossMinor: "100", employerCostMinor: "10", totalCostMinor: "110", perPerson: "9" },
    });
    expect(m).toEqual({
      projectCode: "UMANG",
      periods: [{ period: "2026-09", grossMinor: "100", employerCostMinor: "10", totalCostMinor: "110", headcount: 2 }],
      totals: { grossMinor: "100", employerCostMinor: "10", totalCostMinor: "110" },
    });
    expect(JSON.stringify(m)).not.toMatch(/e1|salary|perPerson|employees/);
  });
  it("is null for a body without totals", () => {
    expect(mapStaffCost({ periods: [] })).toBeNull();
    expect(mapStaffCost(null)).toBeNull();
  });
  it("defaults to the last 12 months", () => {
    expect(defaultRange(new Date(2026, 9, 15))).toEqual({ from: "2025-11", to: "2026-10" });
  });
});
