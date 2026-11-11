import { describe, it, expect } from "vitest";
import {
  PROJECT_COSTING_TOTALS_ROLES, PROJECT_COSTING_VIEW_ROLES, mapAllocations, mapByCostCenter, mapByProject, mapProjectIndex, mapSettings,
  parseAllocationPct, validateAllocationDates,
} from "./projectCostingShared";

describe("project costing roles", () => {
  it("a project manager has no access to payroll-side project costing", () => {
    for (const list of [PROJECT_COSTING_VIEW_ROLES, PROJECT_COSTING_TOTALS_ROLES]) {
      expect(list).not.toContain("project_manager");
      expect(list).not.toContain("project_officer");
      expect(list).not.toContain("employee");
    }
  });
});

describe("parseAllocationPct", () => {
  it("accepts a share above 0 and up to 100 with at most 2 decimals", () => {
    expect(parseAllocationPct("60")).toBe(60);
    expect(parseAllocationPct("33.33")).toBe(33.33);
    expect(parseAllocationPct("100")).toBe(100);
    expect(parseAllocationPct("0.01")).toBe(0.01);
  });
  it("rejects 0, negatives, over 100, 3 decimals and text", () => {
    for (const bad of ["", "0", "-5", "100.01", "12.345", "abc", "1e2", "1,5"]) expect(parseAllocationPct(bad), bad).toBeNull();
  });
});

describe("validateAllocationDates", () => {
  it("needs a start, real dates, and an end that is not before the start", () => {
    expect(validateAllocationDates("", "")).toBe("fromRequiredError");
    expect(validateAllocationDates("2026-02-30", "")).toBe("dateInvalidError");
    expect(validateAllocationDates("2026-04-10", "2026-04-09")).toBe("toBeforeFromError");
    expect(validateAllocationDates("2026-04-10", "")).toBeNull();
    expect(validateAllocationDates("2026-04-10", "2026-04-10")).toBeNull();
  });
});

describe("mappers read known fields only", () => {
  it("by-project keeps the amounts as digit strings and drops rows with bad amounts", () => {
    const rows = mapByProject({ data: [
      { period: "2026-09", projectId: "p1", grossMinor: "1000", employerCostMinor: "100", totalCostMinor: "1100", headcount: 3, employeeId: "must-not-pass" },
      { period: "2026-09", projectId: "p2", grossMinor: "1e3", employerCostMinor: "1", totalCostMinor: "1", headcount: 1 },
    ] });
    expect(rows).toEqual([{ period: "2026-09", projectId: "p1", grossMinor: "1000", employerCostMinor: "100", totalCostMinor: "1100", headcount: 3 }]);
    expect(JSON.stringify(rows)).not.toContain("must-not-pass");
    expect(mapByProject({})).toBeNull();
  });
  it("by-cost-centre separates the unallocated rows", () => {
    const r = mapByCostCenter({
      data: [{ period: "2026-09", costCenterId: "c1", grossMinor: "5", employerCostMinor: "1", totalCostMinor: "6", headcount: 1 }],
      unallocated: [{ period: "2026-09", grossMinor: "9", employerCostMinor: "0", totalCostMinor: "9", headcount: 2 }],
    });
    expect(r!.data).toHaveLength(1);
    expect(r!.unallocated[0]!.totalCostMinor).toBe("9");
  });
  it("allocations, settings and the project index", () => {
    expect(mapSettings({ data: { enabled: true } })).toEqual({ enabled: true });
    expect(mapSettings({ data: {} })).toBeNull();
    const a = mapAllocations({ data: [{ id: "a", employeeId: "e", costCenterId: "c", effectiveFrom: "2026-04-01", splitPct: "60.00", status: "active", targetType: "project", projectId: "p", requestedBy: "u" }, { id: "x" }] });
    expect(a).toHaveLength(1);
    expect(a![0]).toMatchObject({ status: "active", targetType: "project" });
    expect(mapProjectIndex({ data: [{ projectId: "p", code: "UMANG", name: "UMANG", costCenterId: null }] })).toEqual([{ projectId: "p", code: "UMANG", name: "UMANG", costCenterId: null }]);
  });
});
