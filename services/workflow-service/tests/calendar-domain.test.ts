/** CAP-027 — working-calendar SLA arithmetic pure domain. */
import { describe, it, expect } from "vitest";
import {
  computeDueOnCalendar,
  workingMinutesBetween,
  agingMinutes,
  isWorkingDay,
  ALWAYS_ON,
  type WorkingCalendar,
} from "../src/shared/calendar.js";

// Mon–Fri, 09:00–17:00 UTC (480 working minutes/day).
const CAL: WorkingCalendar = {
  timezone: "UTC",
  workweek: [1, 2, 3, 4, 5],
  holidays: ["2025-01-01"],
  workStartMinute: 540,
  workEndMinute: 1020,
};

describe("isWorkingDay", () => {
  it("excludes weekends and holidays", () => {
    expect(isWorkingDay(CAL, new Date("2025-01-02T00:00:00Z"))).toBe(true); // Thu
    expect(isWorkingDay(CAL, new Date("2025-01-04T00:00:00Z"))).toBe(false); // Sat
    expect(isWorkingDay(CAL, new Date("2025-01-01T00:00:00Z"))).toBe(false); // holiday
  });
});

describe("computeDueOnCalendar", () => {
  it("adds working minutes within the same day", () => {
    // Thu 2025-01-02 10:00Z + 120 working min -> 12:00Z
    const due = computeDueOnCalendar(CAL, new Date("2025-01-02T10:00:00Z"), 120);
    expect(due?.toISOString()).toBe("2025-01-02T12:00:00.000Z");
  });

  it("rolls a late-day SLA into the next working morning", () => {
    // Thu 16:00Z + 4h(240) : 60 min left today (→17:00), 180 next day from 09:00 → 12:00 Fri
    const due = computeDueOnCalendar(CAL, new Date("2025-01-02T16:00:00Z"), 240);
    expect(due?.toISOString()).toBe("2025-01-03T12:00:00.000Z");
  });

  it("skips the weekend", () => {
    // Fri 2025-01-03 16:00Z + 120 : 60 today → 17:00 Fri, then Sat/Sun skipped,
    // 60 more Mon 2025-01-06 from 09:00 → 10:00 Mon
    const due = computeDueOnCalendar(CAL, new Date("2025-01-03T16:00:00Z"), 120);
    expect(due?.toISOString()).toBe("2025-01-06T10:00:00.000Z");
  });

  it("returns null for a non-positive SLA and a degenerate calendar", () => {
    expect(computeDueOnCalendar(CAL, new Date(), 0)).toBeNull();
    expect(computeDueOnCalendar({ ...CAL, workweek: [] }, new Date(), 60)).toBeNull();
  });

  it("ALWAYS_ON behaves like plain wall-clock", () => {
    const from = new Date("2025-03-08T22:00:00Z"); // a Saturday night
    const due = computeDueOnCalendar(ALWAYS_ON, from, 180);
    expect(due?.toISOString()).toBe("2025-03-09T01:00:00.000Z");
  });
});

describe("workingMinutesBetween / agingMinutes", () => {
  it("counts only in-window minutes across a boundary", () => {
    // Thu 16:00Z → Fri 10:00Z : 60 (Thu) + 60 (Fri 09-10) = 120
    const mins = workingMinutesBetween(CAL, new Date("2025-01-02T16:00:00Z"), new Date("2025-01-03T10:00:00Z"));
    expect(mins).toBe(120);
  });
  it("subtracts paused minutes and never goes negative", () => {
    const aged = agingMinutes(CAL, new Date("2025-01-02T10:00:00Z"), new Date("2025-01-02T12:00:00Z"), 30);
    expect(aged).toBe(90);
    expect(agingMinutes(CAL, new Date("2025-01-02T10:00:00Z"), new Date("2025-01-02T12:00:00Z"), 9999)).toBe(0);
  });
});
