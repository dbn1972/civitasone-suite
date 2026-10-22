import { describe, it, expect } from "vitest";
import { todayIST, addDaysToDateOnly, addMonthsToDateOnly } from "./ist.js";

describe("todayIST", () => {
  it("is still the previous calendar day just before 05:30 IST would roll over in UTC terms", () => {
    // 2026-03-01T18:29:59Z is 23:59:59 IST on 1 March.
    expect(todayIST(new Date("2026-03-01T18:29:59Z"))).toBe("2026-03-01");
  });

  it("rolls to the next IST calendar day at 18:30 UTC (00:00 IST), when the UTC date is still the old day", () => {
    const instant = new Date("2026-03-01T19:00:00Z"); // 00:30 IST on 2 March
    expect(instant.toISOString().slice(0, 10)).toBe("2026-03-01"); // the UTC date the old code used
    expect(todayIST(instant)).toBe("2026-03-02");
  });
});

describe("addDaysToDateOnly", () => {
  it("adds calendar days across a month boundary", () => {
    expect(addDaysToDateOnly("2026-01-30", 3)).toBe("2026-02-02");
  });
  it("returns null for a non date-only string", () => {
    expect(addDaysToDateOnly("2026-01-30T00:00:00Z", 1)).toBeNull();
    expect(addDaysToDateOnly("not a date", 1)).toBeNull();
  });
});

describe("addMonthsToDateOnly", () => {
  it("adds whole years' worth of months keeping the day", () => {
    expect(addMonthsToDateOnly("2024-01-01", 24)).toBe("2026-01-01");
    expect(addMonthsToDateOnly("2024-01-01", 12)).toBe("2025-01-01");
  });
  it("clamps to the last day of a shorter month instead of overflowing into the next", () => {
    expect(addMonthsToDateOnly("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsToDateOnly("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonthsToDateOnly("2024-02-29", 12)).toBe("2025-02-28");
  });
  it("returns null for a non date-only string", () => {
    expect(addMonthsToDateOnly("", 6)).toBeNull();
  });
});
