import { describe, it, expect } from "vitest";
import { canViewAttendanceRecords, canConfigureAttendance, computeAttendanceStats, ATTENDANCE_VIEW_ROLES } from "./access";
import type { AttendanceSummaryItem } from "@civitasone/types";

describe("canViewAttendanceRecords", () => {
  it("admits every role attendance/routes.ts's own ALL_ROLES admits", () => {
    for (const role of ["hr_admin", "hr_officer", "super_admin", "manager"]) {
      expect(canViewAttendanceRecords([role])).toBe(true);
    }
  });

  it("rejects a bare employee (backend 403s GET /v1/hrms/attendance for this role)", () => {
    expect(canViewAttendanceRecords(["employee"])).toBe(false);
  });

  it("rejects a payroll/tenant/platform admin passed by the layout but not the backend route", () => {
    for (const role of ["payroll_officer", "payroll_admin", "tenant_admin", "platform_admin"]) {
      expect(canViewAttendanceRecords([role])).toBe(false);
    }
  });

  it("exposes exactly the 4 roles this decision is based on (guards against silent drift)", () => {
    expect(new Set(ATTENDANCE_VIEW_ROLES)).toEqual(new Set(["hr_admin", "hr_officer", "super_admin", "manager"]));
  });
});

describe("canConfigureAttendance", () => {
  it("admits only hr_admin/super_admin", () => {
    expect(canConfigureAttendance(["hr_admin"])).toBe(true);
    expect(canConfigureAttendance(["super_admin"])).toBe(true);
  });

  it("rejects hr_officer and manager (view access, not configure access)", () => {
    expect(canConfigureAttendance(["hr_officer"])).toBe(false);
    expect(canConfigureAttendance(["manager"])).toBe(false);
  });
});

const REC = (status: AttendanceSummaryItem["status"]): AttendanceSummaryItem => ({
  id: "a1", employeeId: "e1", employeeName: "Test", department: "Eng", date: "2026-09-01", status,
});

describe("computeAttendanceStats", () => {
  it("counts real records by status when not errored", () => {
    const stats = computeAttendanceStats([REC("present"), REC("present"), REC("absent"), REC("on_leave")], false);
    expect(stats).toEqual({ total: 4, present: 2, absent: 1, onLeave: 1 });
  });

  it("returns null for every stat when errored, instead of a fabricated 0", () => {
    const stats = computeAttendanceStats([], true);
    expect(stats).toEqual({ total: null, present: null, absent: null, onLeave: null });
  });
});
