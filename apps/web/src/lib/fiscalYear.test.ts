import { describe, it, expect } from "vitest";
import { financialYearOf, currentFinancialYear, recentFinancialYears, fiscalYearLabel } from "./fiscalYear";

describe("fiscalYear (Indian FY, Asia/Kolkata boundary)", () => {
  it("maps an August date to the FY that started that April", () => {
    expect(financialYearOf(new Date("2026-08-26T00:00:00Z"))).toBe("2026-27");
  });
  it("maps 1 April to the new FY (boundary)", () => {
    expect(financialYearOf(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
  });
  it("maps a pre-April date to the previous FY", () => {
    expect(financialYearOf(new Date("2026-02-15T00:00:00Z"))).toBe("2025-26");
  });
  it("pads the two-digit end year across a decade boundary", () => {
    expect(financialYearOf(new Date("2009-05-01T00:00:00Z"))).toBe("2009-10");
  });
  it("currentFinancialYear honours an injected clock", () => {
    expect(currentFinancialYear(new Date("2026-08-26T00:00:00Z"))).toBe("2026-27");
  });

  // Regression: the FY boundary is IST, not the process TZ. On a UTC host,
  // 2026-03-31T20:00:00Z is already 2026-04-01 01:30 IST — the new FY has begun.
  // A naive getMonth() on UTC would read March and return 2025-26.
  it("uses the IST calendar day at the March/April boundary (UTC host safe)", () => {
    expect(financialYearOf(new Date("2026-03-31T20:00:00Z"))).toBe("2026-27");
    expect(currentFinancialYear(new Date("2026-03-31T20:00:00Z"))).toBe("2026-27");
  });
  it("still reads the previous FY just before midnight IST on 31 March", () => {
    // 2026-03-31T18:00:00Z = 2026-03-31 23:30 IST — still the old FY.
    expect(financialYearOf(new Date("2026-03-31T18:00:00Z"))).toBe("2025-26");
  });

  it("recentFinancialYears lists the current FY and preceding ones, newest first", () => {
    expect(recentFinancialYears(3, new Date("2026-08-26T00:00:00Z"))).toEqual([
      "2026-27",
      "2025-26",
      "2024-25",
    ]);
  });
  it("fiscalYearLabel formats a start year", () => {
    expect(fiscalYearLabel(2026)).toBe("2026-27");
  });
});
