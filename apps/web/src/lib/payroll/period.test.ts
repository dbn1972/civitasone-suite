import { describe, it, expect } from "vitest";
import { isValidFinancialYear, isValidPeriod, parsePeriodParam } from "./period";

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
