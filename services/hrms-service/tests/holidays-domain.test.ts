/**
 * HRMS Pack #17 — Holidays: Working day calculation tests.
 *
 * Source: modules/leave/holidays.ts
 * Tests isWorkingDay (weekends, restricted holidays, normal days)
 * and countWorkingDays (range calculation with minimum-1 guarantee).
 */
import { describe, it, expect } from "vitest";
import { isWorkingDay, countWorkingDays, RESTRICTED_HOLIDAYS } from "../src/modules/leave/holidays.js";

describe("RESTRICTED_HOLIDAYS constant", () => {
  it("contains Republic Day 2026", () => {
    expect(RESTRICTED_HOLIDAYS.has("2026-01-26")).toBe(true);
  });

  it("contains Independence Day 2026", () => {
    expect(RESTRICTED_HOLIDAYS.has("2026-08-15")).toBe(true);
  });

  it("contains Gandhi Jayanti 2026", () => {
    expect(RESTRICTED_HOLIDAYS.has("2026-10-02")).toBe(true);
  });

  it("contains Christmas 2026", () => {
    expect(RESTRICTED_HOLIDAYS.has("2026-12-25")).toBe(true);
  });

  it("does not contain a random date", () => {
    expect(RESTRICTED_HOLIDAYS.has("2026-07-15")).toBe(false);
  });
});

describe("isWorkingDay", () => {
  it("returns true for a regular Monday", () => {
    // 2026-07-06 is a Monday
    expect(isWorkingDay("2026-07-06")).toBe(true);
  });

  it("returns true for a Friday", () => {
    // 2026-07-10 is a Friday
    expect(isWorkingDay("2026-07-10")).toBe(true);
  });

  it("returns false for a Saturday", () => {
    // 2026-07-11 is a Saturday
    expect(isWorkingDay("2026-07-11")).toBe(false);
  });

  it("returns false for a Sunday", () => {
    // 2026-07-12 is a Sunday
    expect(isWorkingDay("2026-07-12")).toBe(false);
  });

  it("returns false for a restricted holiday (Republic Day)", () => {
    expect(isWorkingDay("2026-01-26")).toBe(false);
  });

  it("returns false for Independence Day even if it's a weekday", () => {
    // 2026-08-15 is a Saturday, so it's false anyway — check 2025-08-15 (Friday)
    expect(isWorkingDay("2025-08-15")).toBe(false);
  });
});

describe("countWorkingDays", () => {
  it("single day that is a working day returns 1", () => {
    expect(countWorkingDays("2026-07-06", "2026-07-06")).toBe(1);
  });

  it("Mon-Fri week returns 5 working days", () => {
    // 2026-07-06 (Mon) to 2026-07-10 (Fri)
    expect(countWorkingDays("2026-07-06", "2026-07-10")).toBe(5);
  });

  it("Mon-Sun (7 calendar days) returns 5 working days", () => {
    // 2026-07-06 (Mon) to 2026-07-12 (Sun)
    expect(countWorkingDays("2026-07-06", "2026-07-12")).toBe(5);
  });

  it("Saturday-only returns minimum 1 (guarantee)", () => {
    // 2026-07-11 is a Saturday — non-working but function returns max(0,1)=1
    expect(countWorkingDays("2026-07-11", "2026-07-11")).toBe(1);
  });

  it("range including a restricted holiday excludes it", () => {
    // 2026-01-26 (Monday, Republic Day) in a Mon-Fri week
    // 2026-01-26 is actually a Monday in 2026
    expect(countWorkingDays("2026-01-26", "2026-01-30")).toBe(4); // 5 weekdays - 1 holiday
  });

  it("two-week period returns approximately 10 working days", () => {
    // 2026-07-06 (Mon) to 2026-07-17 (Fri) = 10 weekdays
    expect(countWorkingDays("2026-07-06", "2026-07-17")).toBe(10);
  });
});
