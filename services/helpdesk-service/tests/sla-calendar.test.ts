/**
 * helpdesk-service — SLA Calendar tests
 *
 * Tests cover:
 *  - computeDeadline: business-hours-aware deadline computation
 *  - computeElapsedBusinessMinutes: elapsed business time
 *  - Holiday skipping
 *  - Weekend skipping
 *  - Multi-day spans
 *  - Edge cases
 *
 * Requirements: SLA-02
 */
import { describe, it, expect } from "vitest";
import { computeDeadline, computeElapsedBusinessMinutes } from "../src/modules/sla/calendar-domain.js";
import type { WorkDay, Holiday } from "../src/modules/sla/calendar-schema.js";

// ─── Test Calendar ────────────────────────────────────────────────────────────

const STANDARD_WORK_DAYS: WorkDay[] = [
  { day: 1, start: "09:00", end: "17:00" }, // Monday
  { day: 2, start: "09:00", end: "17:00" }, // Tuesday
  { day: 3, start: "09:00", end: "17:00" }, // Wednesday
  { day: 4, start: "09:00", end: "17:00" }, // Thursday
  { day: 5, start: "09:00", end: "17:00" }, // Friday
];

const STANDARD_CALENDAR = {
  workDays: STANDARD_WORK_DAYS,
  holidays: [] as Holiday[],
  timezone: "UTC",
};

// ─── computeDeadline ──────────────────────────────────────────────────────────

describe("computeDeadline — business hours aware", () => {
  it("adds minutes within a single work day", () => {
    // Monday 2025-01-06 at 09:00 UTC + 60 min = 10:00
    const start = new Date("2025-01-06T09:00:00Z");
    const deadline = computeDeadline(start, 60, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-06T10:00:00Z"));
  });

  it("carries over to next work day when exceeding day hours", () => {
    // Monday 2025-01-06 at 16:00 UTC + 120 min (2h)
    // Only 60 min remain Mon (16:00-17:00), then 60 min Tue starting at 09:00
    const start = new Date("2025-01-06T16:00:00Z");
    const deadline = computeDeadline(start, 120, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-07T10:00:00Z"));
  });

  it("skips weekends", () => {
    // Friday 2025-01-10 at 16:00 UTC + 120 min
    // Only 60 min remain Fri, then skip Sat+Sun, 60 min Mon starting at 09:00
    const start = new Date("2025-01-10T16:00:00Z");
    const deadline = computeDeadline(start, 120, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-13T10:00:00Z"));
  });

  it("skips holidays", () => {
    const calendarWithHoliday = {
      ...STANDARD_CALENDAR,
      holidays: [{ date: "2025-01-07", name: "Holiday" }] as Holiday[],
    };
    // Monday 2025-01-06 at 16:00 + 120 min
    // 60 min Mon, skip Tue (holiday), 60 min Wed starting at 09:00
    const start = new Date("2025-01-06T16:00:00Z");
    const deadline = computeDeadline(start, 120, calendarWithHoliday);
    expect(deadline).toEqual(new Date("2025-01-08T10:00:00Z"));
  });

  it("handles start time before work hours", () => {
    // Monday at 07:00 (before 09:00 start) + 60 min
    const start = new Date("2025-01-06T07:00:00Z");
    const deadline = computeDeadline(start, 60, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-06T10:00:00Z"));
  });

  it("handles start time after work hours", () => {
    // Monday at 18:00 (after 17:00 end) + 60 min → Tuesday 10:00
    const start = new Date("2025-01-06T18:00:00Z");
    const deadline = computeDeadline(start, 60, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-07T10:00:00Z"));
  });

  it("handles full work day (480 min)", () => {
    // Monday at 09:00 + 480 min (8h) = Monday 17:00
    const start = new Date("2025-01-06T09:00:00Z");
    const deadline = computeDeadline(start, 480, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-06T17:00:00Z"));
  });

  it("handles multi-day span", () => {
    // Monday at 09:00 + 960 min (2 full days) = Wednesday 09:00... wait
    // 480 (Mon) + 480 (Tue) = 960 → ends at Tue 17:00
    const start = new Date("2025-01-06T09:00:00Z");
    const deadline = computeDeadline(start, 960, STANDARD_CALENDAR);
    expect(deadline).toEqual(new Date("2025-01-07T17:00:00Z"));
  });

  it("returns start time when minutes is 0", () => {
    const start = new Date("2025-01-06T10:00:00Z");
    expect(computeDeadline(start, 0, STANDARD_CALENDAR)).toEqual(start);
  });

  it("returns start time when minutes is negative", () => {
    const start = new Date("2025-01-06T10:00:00Z");
    expect(computeDeadline(start, -5, STANDARD_CALENDAR)).toEqual(start);
  });
});

// ─── computeElapsedBusinessMinutes ────────────────────────────────────────────

describe("computeElapsedBusinessMinutes", () => {
  it("computes elapsed within a single work day", () => {
    const start = new Date("2025-01-06T09:00:00Z");
    const end = new Date("2025-01-06T12:00:00Z");
    expect(computeElapsedBusinessMinutes(start, end, STANDARD_CALENDAR)).toBe(180); // 3h
  });

  it("excludes non-work hours", () => {
    const start = new Date("2025-01-06T16:00:00Z");
    const end = new Date("2025-01-07T10:00:00Z");
    // Mon 16:00-17:00 = 60min, Tue 09:00-10:00 = 60min = 120 total
    expect(computeElapsedBusinessMinutes(start, end, STANDARD_CALENDAR)).toBe(120);
  });

  it("excludes weekends", () => {
    const start = new Date("2025-01-10T16:00:00Z"); // Friday
    const end = new Date("2025-01-13T10:00:00Z"); // Monday
    // Fri 16:00-17:00 = 60min, Mon 09:00-10:00 = 60min = 120 total
    expect(computeElapsedBusinessMinutes(start, end, STANDARD_CALENDAR)).toBe(120);
  });

  it("excludes holidays", () => {
    const calendarWithHoliday = {
      ...STANDARD_CALENDAR,
      holidays: [{ date: "2025-01-07", name: "Holiday" }] as Holiday[],
    };
    const start = new Date("2025-01-06T09:00:00Z"); // Monday
    const end = new Date("2025-01-08T09:00:00Z"); // Wednesday
    // Mon 09:00-17:00 = 480min, Tue is holiday (0), Wed 09:00-09:00 = 0
    expect(computeElapsedBusinessMinutes(start, end, calendarWithHoliday)).toBe(480);
  });

  it("returns 0 for end before start", () => {
    const start = new Date("2025-01-06T12:00:00Z");
    const end = new Date("2025-01-06T10:00:00Z");
    expect(computeElapsedBusinessMinutes(start, end, STANDARD_CALENDAR)).toBe(0);
  });

  it("returns 0 for same start and end", () => {
    const start = new Date("2025-01-06T10:00:00Z");
    expect(computeElapsedBusinessMinutes(start, start, STANDARD_CALENDAR)).toBe(0);
  });
});

// ─── Custom Calendar Configurations ───────────────────────────────────────────

describe("Custom calendar configurations", () => {
  it("supports 6-day work week", () => {
    const sixDayCalendar = {
      workDays: [
        ...STANDARD_WORK_DAYS,
        { day: 6, start: "09:00", end: "13:00" }, // Saturday half-day
      ] as WorkDay[],
      holidays: [] as Holiday[],
      timezone: "Asia/Kolkata",
    };

    // Friday 2025-01-10 at 16:00 + 120 min
    // 60 min Fri (16-17), skip Sun (not in workDays), Sat 09-13 has 4h
    // Actually Sat 09:00 + remaining 60 min = 10:00
    const start = new Date("2025-01-10T16:00:00Z");
    const deadline = computeDeadline(start, 120, sixDayCalendar);
    expect(deadline).toEqual(new Date("2025-01-11T10:00:00Z"));
  });

  it("supports non-standard work hours", () => {
    const eveningShift = {
      workDays: [
        { day: 1, start: "14:00", end: "22:00" },
        { day: 2, start: "14:00", end: "22:00" },
        { day: 3, start: "14:00", end: "22:00" },
        { day: 4, start: "14:00", end: "22:00" },
        { day: 5, start: "14:00", end: "22:00" },
      ] as WorkDay[],
      holidays: [] as Holiday[],
      timezone: "UTC",
    };

    // Monday at 14:00 + 60 min = 15:00
    const start = new Date("2025-01-06T14:00:00Z");
    const deadline = computeDeadline(start, 60, eveningShift);
    expect(deadline).toEqual(new Date("2025-01-06T15:00:00Z"));
  });
});
