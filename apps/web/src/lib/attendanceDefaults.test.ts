import { describe, it, expect } from "vitest";
import { ATTENDANCE_DEFAULTS } from "./attendanceDefaults";

/**
 * GAP-HR-ATTENDANCE-CONFIG-02 acceptance: "Changing a value in
 * attendanceDefaults.ts changes the page in every locale." This suite
 * mostly guards against silent, accidental drift in these values (a typo
 * during some future edit) now that they're the single source of truth --
 * the actual current numbers are carried over byte-for-byte from what
 * messages/en.json previously displayed statically.
 */
describe("ATTENDANCE_DEFAULTS", () => {
  it("carries the same values the page previously displayed statically", () => {
    expect(ATTENDANCE_DEFAULTS).toEqual({
      officeStartTime: "09:30",
      officeEndTime: "18:00",
      graceMinutes: 15,
      halfDayCutoffTime: "12:30",
      minHoursForFullDay: 7.5,
      weeklyOffDays: "Saturday & Sunday",
      lateMarkGraceMinutes: 15,
      lateMarkTriggerTime: "09:45",
      halfDayIfAfterTime: "12:30",
      absentIfNoCheckInAfterTime: "14:00",
      lateMarksPerClDeducted: 3,
      otEligibleAfterHours: 8.5,
      otRateWeekdayMultiplier: 1.5,
      otRateWeeklyOffMultiplier: 2,
      otMaxHoursPerDay: 4,
      otApprovalText: "Yes (supervisor)",
      coEarnedWhen: "Worked on a holiday / weekly off",
      coMustAvailWithinDays: 30,
      coMaxAccumulation: 3,
      coApprovalText: "Yes (supervisor)",
    });
  });

  it("times are stored as 24h HH:mm (page.tsx formats for display, never stores a pre-formatted string)", () => {
    for (const key of ["officeStartTime", "officeEndTime", "halfDayCutoffTime", "lateMarkTriggerTime", "halfDayIfAfterTime", "absentIfNoCheckInAfterTime"] as const) {
      expect(ATTENDANCE_DEFAULTS[key]).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
