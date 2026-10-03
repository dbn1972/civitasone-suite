import { describe, it, expect } from "vitest";
import { availableDayParts, daysForPart, parseLeaveConfig, NO_PART_DAY_CONFIG } from "./dayPart";

describe("availableDayParts (GAP-HR-LEAVE-APPLY-05)", () => {
  const on = { halfDayEnabled: true, shortLeaveEnabled: true };
  it("offers only a full day while the tenant switch is OFF (default)", () => {
    expect(availableDayParts(NO_PART_DAY_CONFIG, "CL", true)).toEqual(["full"]);
  });
  it("offers halves and short leave for CL on a single date once enabled", () => {
    expect(availableDayParts(on, "CL", true)).toEqual(["full", "first_half", "second_half", "short_leave"]);
    expect(availableDayParts({ halfDayEnabled: true, shortLeaveEnabled: false }, "cl", true)).toEqual(["full", "first_half", "second_half"]);
    expect(availableDayParts({ halfDayEnabled: false, shortLeaveEnabled: true }, "CL", true)).toEqual(["full", "short_leave"]);
  });
  it("never offers a part day for a date range or a non-CL type", () => {
    expect(availableDayParts(on, "CL", false)).toEqual(["full"]);
    expect(availableDayParts(on, "EL", true)).toEqual(["full"]);
    expect(availableDayParts(on, undefined, true)).toEqual(["full"]);
  });
});

describe("daysForPart / parseLeaveConfig", () => {
  it("counts 0.5 for a part and the calendar span for a full day", () => {
    expect(daysForPart("full", 3)).toBe(3);
    expect(daysForPart("first_half", 1)).toBe(0.5);
    expect(daysForPart("short_leave", 1)).toBe(0.5);
  });
  it("treats anything unexpected as OFF", () => {
    expect(parseLeaveConfig(null)).toEqual(NO_PART_DAY_CONFIG);
    expect(parseLeaveConfig({ halfDayEnabled: "yes" })).toEqual(NO_PART_DAY_CONFIG);
    expect(parseLeaveConfig({ halfDayEnabled: true, shortLeaveEnabled: false })).toEqual({ halfDayEnabled: true, shortLeaveEnabled: false });
  });
});
