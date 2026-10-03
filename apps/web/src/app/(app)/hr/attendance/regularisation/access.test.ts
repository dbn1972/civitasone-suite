import { describe, it, expect } from "vitest";
import { canViewRegularisations, canPickRegularisationEmployee, computeRegularisationStats, REGULARISATION_VIEW_ROLES } from "./access";
import type { AttendanceRegularisation } from "@civitasone/types";

describe("canViewRegularisations", () => {
  it("admits every role attendance/routes.ts's GET .../regularisations admits", () => {
    for (const role of ["hr_admin", "hr_officer", "super_admin", "manager", "employee"]) {
      expect(canViewRegularisations([role])).toBe(true);
    }
  });

  // GAP-HR-ATTENDANCE-REGULARISATION-01: employees raise their own requests,
  // so they may open the page (the backend scopes the list to their own rows).
  it("still rejects roles the backend refuses", () => {
    expect(canViewRegularisations(["payroll_officer"])).toBe(false);
    expect(canViewRegularisations(["tenant_admin"])).toBe(false);
  });

  it("exposes exactly the 5 roles this decision is based on (guards against silent drift)", () => {
    expect(new Set(REGULARISATION_VIEW_ROLES)).toEqual(new Set(["hr_admin", "hr_officer", "super_admin", "manager", "employee"]));
  });

  it("only HR and managers pick who a request is for; an employee raises their own", () => {
    expect(canPickRegularisationEmployee(["employee"])).toBe(false);
    expect(canPickRegularisationEmployee(["manager"])).toBe(true);
    expect(canPickRegularisationEmployee(["hr_officer"])).toBe(true);
  });
});

const REG = (status: AttendanceRegularisation["status"]): AttendanceRegularisation => ({
  id: "r1", employeeId: "e1", employeeName: "Test", date: "2026-09-01", reason: "Forgot to check in",
  requestedStatus: "present", requestedAt: "2026-09-01T00:00:00.000Z", status,
});

describe("computeRegularisationStats", () => {
  it("counts real records by status when not errored", () => {
    const stats = computeRegularisationStats([REG("pending"), REG("pending"), REG("approved"), REG("rejected")], false);
    expect(stats).toEqual({ total: 4, pending: 2, approved: 1, rejected: 1 });
  });

  it("returns null for every stat when errored, instead of a fabricated 0", () => {
    expect(computeRegularisationStats([], true)).toEqual({ total: null, pending: null, approved: null, rejected: null });
  });
});
