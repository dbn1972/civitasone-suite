import { describe, it, expect } from "vitest";
import { computePresentTodayPct } from "./present-today.js";

const emp = (id: string, employeeStatus: string, attendanceStatus: string | null) => ({ id, employeeStatus, attendanceStatus });

describe("computePresentTodayPct (GAP-HR-DASHBOARD-07)", () => {
  it("10 headcount, 2 on_leave, 4 present -> 4/8 = 50%", () => {
    const employees = [
      ...Array.from({ length: 4 }, (_, i) => emp(`p${i}`, "confirmed", "present")),
      ...Array.from({ length: 2 }, (_, i) => emp(`l${i}`, "on_leave", null)),
      ...Array.from({ length: 4 }, (_, i) => emp(`a${i}`, "confirmed", "absent")),
    ];
    expect(computePresentTodayPct({ employees, wfhEmployeeIds: [], nonWorkingDay: false })).toBe(50);
  });

  it("half_day counts 0.5 and still sits in the denominator", () => {
    const employees = [emp("a", "confirmed", "present"), emp("b", "confirmed", "half_day"), emp("c", "confirmed", "absent"), emp("d", "confirmed", "absent")];
    expect(computePresentTodayPct({ employees, wfhEmployeeIds: [], nonWorkingDay: false })).toBe(38); // 1.5/4 = 37.5 -> 38
  });

  it("approved WFH with no attendance row counts as present", () => {
    const employees = [emp("a", "confirmed", "present"), emp("b", "confirmed", null)];
    expect(computePresentTodayPct({ employees, wfhEmployeeIds: ["b"], nonWorkingDay: false })).toBe(100);
  });

  it("holiday rows leave the denominator", () => {
    const employees = [emp("a", "confirmed", "present"), emp("b", "confirmed", "holiday"), emp("c", "confirmed", "absent")];
    expect(computePresentTodayPct({ employees, wfhEmployeeIds: [], nonWorkingDay: false })).toBe(50);
  });

  it("on a non-working day only people who actually worked are in the denominator", () => {
    const employees = [emp("a", "confirmed", "present"), emp("b", "confirmed", null), emp("c", "confirmed", "absent")];
    expect(computePresentTodayPct({ employees, wfhEmployeeIds: [], nonWorkingDay: true })).toBe(100);
  });

  it("nobody in the working population -> 0, never NaN", () => {
    expect(computePresentTodayPct({ employees: [emp("a", "on_leave", null)], wfhEmployeeIds: [], nonWorkingDay: false })).toBe(0);
    expect(computePresentTodayPct({ employees: [], wfhEmployeeIds: [], nonWorkingDay: false })).toBe(0);
  });
});
