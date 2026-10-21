/**
 * GAP-HR-WFH-01 -- the 2-days-per-ISO-week cap is counted in DAYS.
 *
 * Pure unit tests (no DB). The first cut counted existing request ROWS whose
 * fromDate fell in the week and never looked at the new request's own span, so
 * a single Monday-Friday request passed. 2026-03-02 is a Monday.
 */
import { describe, it, expect } from "vitest";
import {
  WFH_WEEKLY_DAY_CAP,
  findWfhWeeklyOverflow,
  isValidIsoDate,
  isoWeekBounds,
  wfhDaysUsedInWeek,
} from "../modules/attendance/wfh-week-cap.js";

const r = (fromDate: string, toDate = fromDate) => ({ fromDate, toDate });

describe("isValidIsoDate", () => {
  it("accepts real calendar dates and rejects shape-valid impossible ones", () => {
    expect(isValidIsoDate("2026-03-02")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true); // leap day
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("05-10-2026")).toBe(false);
  });
});

describe("isoWeekBounds", () => {
  it("returns Monday-Sunday for any day in the week, incl. a Sunday and a year boundary", () => {
    expect(isoWeekBounds("2026-03-02")).toEqual({ start: "2026-03-02", end: "2026-03-08" }); // Monday
    expect(isoWeekBounds("2026-03-04")).toEqual({ start: "2026-03-02", end: "2026-03-08" });
    expect(isoWeekBounds("2026-03-08")).toEqual({ start: "2026-03-02", end: "2026-03-08" }); // Sunday
    expect(isoWeekBounds("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });
});

describe("findWfhWeeklyOverflow", () => {
  it("the cap is 2 days", () => {
    expect(WFH_WEEKLY_DAY_CAP).toBe(2);
  });

  it("allows one day, and two days in a week (single request or two requests)", () => {
    expect(findWfhWeeklyOverflow(r("2026-03-02"), [])).toBeNull();
    expect(findWfhWeeklyOverflow(r("2026-03-02", "2026-03-03"), [])).toBeNull(); // Mon-Tue = 2 days
    expect(findWfhWeeklyOverflow(r("2026-03-03"), [r("2026-03-02")])).toBeNull(); // 1 existing + 1 new
  });

  it("rejects a SINGLE multi-day request that spans more than 2 days (Mon-Fri was one row and used to pass)", () => {
    expect(findWfhWeeklyOverflow(r("2026-03-02", "2026-03-06"), [])).toEqual({ weekStart: "2026-03-02", days: 5 });
    expect(findWfhWeeklyOverflow(r("2026-03-02", "2026-03-04"), [])).toEqual({ weekStart: "2026-03-02", days: 3 });
  });

  it("counts the NEW request's days on top of an existing multi-day request (2 existing days + 1 new)", () => {
    const existing = [r("2026-03-02", "2026-03-03")]; // one row, two days
    expect(findWfhWeeklyOverflow(r("2026-03-05"), existing)).toEqual({ weekStart: "2026-03-02", days: 3 });
  });

  it("a request on a day already held by another request adds nothing (days are de-duplicated)", () => {
    const existing = [r("2026-03-02"), r("2026-03-03")];
    expect(findWfhWeeklyOverflow(r("2026-03-03"), existing)).toBeNull();
  });

  it("counts only the days INSIDE each ISO week: Sun-Tue is 1 + 2 days, Sun-Wed is 1 + 3", () => {
    expect(findWfhWeeklyOverflow(r("2026-03-08", "2026-03-10"), [])).toBeNull(); // Sun | Mon, Tue
    expect(findWfhWeeklyOverflow(r("2026-03-07", "2026-03-10"), [])).toBeNull(); // Sat, Sun | Mon, Tue
    expect(findWfhWeeklyOverflow(r("2026-03-08", "2026-03-11"), [])).toEqual({ weekStart: "2026-03-09", days: 3 }); // Mon-Wed
  });

  it("weekends count (calendar days, conservative): Fri-Sun is 3 days in one week, so Fri-Mon is refused", () => {
    expect(findWfhWeeklyOverflow(r("2026-03-06", "2026-03-08"), [])).toEqual({ weekStart: "2026-03-02", days: 3 });
    expect(findWfhWeeklyOverflow(r("2026-03-06", "2026-03-09"), [])).toEqual({ weekStart: "2026-03-02", days: 3 });
  });

  it("an existing request from the previous week that runs into this one counts for the days inside this week", () => {
    const existing = [r("2026-02-27", "2026-03-03")]; // Fri-Tue: Mon+Tue fall in the week of 03-02
    expect(findWfhWeeklyOverflow(r("2026-03-04"), existing)).toEqual({ weekStart: "2026-03-02", days: 3 });
    expect(findWfhWeeklyOverflow(r("2026-03-09"), existing)).toBeNull(); // following week is unaffected
  });

  it("returns at the first over-cap week, so an absurdly long range terminates immediately", () => {
    // 2000-01-01 is a Saturday: week 1 holds Sat+Sun (2, within the cap), week 2 is a full 7.
    expect(findWfhWeeklyOverflow(r("2000-01-01", "9999-12-31"), [])).toEqual({ weekStart: "2000-01-03", days: 7 });
  });
});

describe("wfhDaysUsedInWeek", () => {
  it("is the number of distinct days used in that ISO week, clamped to the week", () => {
    const week = "2026-03-04"; // Wednesday of the week of 03-02
    expect(wfhDaysUsedInWeek([], week)).toBe(0);
    expect(wfhDaysUsedInWeek([r("2026-03-02", "2026-03-03")], week)).toBe(2); // one row, two days
    expect(wfhDaysUsedInWeek([r("2026-02-25", "2026-03-02")], week)).toBe(1); // only Monday is in-week
    expect(wfhDaysUsedInWeek([r("2026-03-02"), r("2026-03-02"), r("2026-03-09")], week)).toBe(1); // dup + other week
  });
});
