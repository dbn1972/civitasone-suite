import { describe, it, expect } from "vitest";
import { examplePeriods, formatPayPeriodLabel, isValidFinancialYear, isValidPeriod, parsePeriodParam } from "./period";

describe("isValidPeriod (GAP-PAYROLL-COMPARISON-01)", () => {
  it.each(["2026-8", "2026-13", "2026-00", "0000-00", "2026/08", "", "2026-08-01"])("rejects %s", (v) => {
    expect(isValidPeriod(v)).toBe(false);
  });
  it.each(["2026-08", "2026-01", "2026-12"])("accepts %s", (v) => {
    expect(isValidPeriod(v)).toBe(true);
  });
});

describe("parsePeriodParam", () => {
  it("separates empty, valid and invalid", () => {
    expect(parsePeriodParam(undefined)).toEqual({ state: "empty" });
    expect(parsePeriodParam(" 2026-08 ")).toEqual({ state: "valid", period: "2026-08" });
    expect(parsePeriodParam("2026-13")).toEqual({ state: "invalid", raw: "2026-13" });
  });
});

describe("isValidFinancialYear (GAP-PAYROLL-RETURNS-07)", () => {
  it("requires the suffix to be the following year", () => {
    expect(isValidFinancialYear("2025-26")).toBe(true);
    expect(isValidFinancialYear("2099-00")).toBe(true);
    expect(isValidFinancialYear("2025-99")).toBe(false);
    expect(isValidFinancialYear("2025/26")).toBe(false);
  });
});

describe("examplePeriods (GAP-PAYROLL-COMPARISON-05)", () => {
  it("returns previous and current month, rolling over January", () => {
    expect(examplePeriods(new Date(2026, 9, 2))).toEqual({ previous: "2026-09", current: "2026-10" });
    expect(examplePeriods(new Date(2027, 0, 15))).toEqual({ previous: "2026-12", current: "2027-01" });
  });
});

describe("formatPayPeriodLabel (GAP-PAYROLL-HOME-03)", () => {
  it("turns a YYYY-MM period into a month and year", () => {
    expect(formatPayPeriodLabel("2026-09")).toBe("September 2026");
    expect(formatPayPeriodLabel("2026-01")).toBe("January 2026");
    expect(formatPayPeriodLabel("2026-12")).toBe("December 2026");
  });
  it("returns anything that is not a real period unchanged instead of guessing", () => {
    expect(formatPayPeriodLabel("2026-13")).toBe("2026-13");
    expect(formatPayPeriodLabel("2026-00")).toBe("2026-00");
    expect(formatPayPeriodLabel("September 2026")).toBe("September 2026");
  });
});
