import { describe, it, expect } from "vitest";
import { canViewRegularisations, computeRegularisationStats, REGULARISATION_VIEW_ROLES } from "./access";
import type { AttendanceRegularisation } from "@civitasone/types";

describe("canViewRegularisations", () => {
  it("admits every role attendance/routes.ts's own ALL_ROLES admits", () => {
    for (const role of ["hr_admin", "hr_officer", "super_admin", "manager"]) {
      expect(canViewRegularisations([role])).toBe(true);
    }
  });

  it("rejects a bare employee (backend 403s GET .../regularisations for this role)", () => {
    expect(canViewRegularisations(["employee"])).toBe(false);
  });

  it("exposes exactly the 4 roles this decision is based on (guards against silent drift)", () => {
    expect(new Set(REGULARISATION_VIEW_ROLES)).toEqual(new Set(["hr_admin", "hr_officer", "super_admin", "manager"]));
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
