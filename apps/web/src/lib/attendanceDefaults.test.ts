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
  // The four text rows are closed codes now (rendered through an ICU `select`
  // per locale) instead of English sentences, so the Hindi page no longer shows
  // English for them; the displayed meaning is unchanged (see
  // attendance/config/page.test.tsx for the rendered rows in en and hi).
  it("carries the same values the page previously displayed statically", () => {
    expect(ATTENDANCE_DEFAULTS).toEqual({
      officeStartTime: "09:30",
      officeEndTime: "18:00",
      graceMinutes: 15,
      halfDayCutoffTime: "12:30",
      minHoursForFullDay: 7.5,
      weeklyOffPattern: "sat_sun",
      lateMarkGraceMinutes: 15,
      lateMarkTriggerTime: "09:45",
      halfDayIfAfterTime: "12:30",
      absentIfNoCheckInAfterTime: "14:00",
      lateMarksPerClDeducted: 3,
      otEligibleAfterHours: 8.5,
      otRateWeekdayMultiplier: 1.5,
      otRateWeeklyOffMultiplier: 2,
      otMaxHoursPerDay: 4,
      otApprovedBy: "supervisor",
      coEarnedRule: "holiday_or_weekly_off",
      coMustAvailWithinDays: 30,
      coMaxAccumulation: 3,
      coApprovedBy: "supervisor",
    });
  });

  it("times are stored as 24h HH:mm (page.tsx formats for display, never stores a pre-formatted string)", () => {
    for (const key of ["officeStartTime", "officeEndTime", "halfDayCutoffTime", "lateMarkTriggerTime", "halfDayIfAfterTime", "absentIfNoCheckInAfterTime"] as const) {
      expect(ATTENDANCE_DEFAULTS[key]).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
