import { describe, it, expect } from "vitest";
import {
  findFiscalYearConflicts,
  financialYearOf,
  currentFinancialYear,
  recentFinancialYears,
  fiscalYearLabel,
  currentMonthPeriod,
  validateFiscalYear,
  standardFiscalYear,
} from "./fiscalYear";

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

  // currentMonthPeriod backs the GST filing-period default (previously a
  // local, UTC-naive reimplementation in finance/gst/page.tsx). Same
  // IST-boundary bug class as financialYearOf above, one calendar-month scope.
  describe("currentMonthPeriod", () => {
    it("formats a mid-month IST date as YYYY-MM", () => {
      expect(currentMonthPeriod(new Date("2026-08-26T00:00:00Z"))).toBe("2026-08");
    });
    it("rolls over to the next month at the IST boundary (UTC host safe)", () => {
      // 2026-03-31T20:00:00Z = 2026-04-01 01:30 IST — already April in IST.
      expect(currentMonthPeriod(new Date("2026-03-31T20:00:00Z"))).toBe("2026-04");
    });
    it("still reads the previous month just before midnight IST", () => {
      // 2026-03-31T18:00:00Z = 2026-03-31 23:30 IST — still March.
      expect(currentMonthPeriod(new Date("2026-03-31T18:00:00Z"))).toBe("2026-03");
    });
    it("pads single-digit months", () => {
      expect(currentMonthPeriod(new Date("2026-01-05T06:00:00Z"))).toBe("2026-01");
    });
  });
});

import { isValidFinancialYearLabel } from "./fiscalYear";

describe("isValidFinancialYearLabel (GAP-PAYROLL-FLEX-BENEFITS-03)", () => {
  it("accepts consecutive-year labels, including the century wrap", () => {
    expect(isValidFinancialYearLabel("2026-27")).toBe(true);
    expect(isValidFinancialYearLabel("1999-00")).toBe(true);
  });
  it("rejects non-consecutive or malformed labels", () => {
    expect(isValidFinancialYearLabel("2026-99")).toBe(false);
    expect(isValidFinancialYearLabel("2026-05")).toBe(false);
    expect(isValidFinancialYearLabel("2025-27")).toBe(false);
    expect(isValidFinancialYearLabel("2026/27")).toBe(false);
    expect(isValidFinancialYearLabel("")).toBe(false);
  });
});

describe("findFiscalYearConflicts (GAP-FINANCE-FISCAL-YEARS-01)", () => {
  const rows = [
    { code: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" },
    { code: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" },
  ];
  it("flags an overlapping range", () => {
    expect(findFiscalYearConflicts({ code: "2026-28", startDate: "2027-01-01", endDate: "2027-12-31" }, rows).overlapsWith).toBe("2026-27");
  });
  it("flags a duplicate code", () => {
    expect(findFiscalYearConflicts({ code: "2026-27", startDate: "2028-04-01", endDate: "2029-03-31" }, rows).duplicateOf).toBe("2026-27");
  });
  it("accepts the next contiguous year with no warning", () => {
    expect(findFiscalYearConflicts({ code: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31" }, rows)).toEqual({});
  });
  it("reports a gap after the latest earlier year", () => {
    expect(findFiscalYearConflicts({ code: "2028-29", startDate: "2028-04-01", endDate: "2029-03-31" }, rows).gapAfter).toEqual({ code: "2026-27", days: 366 });
  });
});

describe("validateFiscalYear (GAP-FINANCE-FISCAL-YEARS-05)", () => {
  const ok = { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31" };
  it("accepts a standard 1 Apr - 31 Mar year", () => {
    expect(validateFiscalYear(ok)).toEqual({});
  });
  it("rejects '2026-99' and '2026-28' (suffix is not the following year)", () => {
    expect(validateFiscalYear({ ...ok, code: "2026-99" }).code).toMatch(/second part must be 27/);
    expect(validateFiscalYear({ ...ok, code: "2026-28" }).code).toMatch(/second part must be 27/);
  });
  it("rejects a malformed code with the format message", () => {
    expect(validateFiscalYear({ ...ok, code: "bad-code" }).code).toBe("Code must be in YYYY-YY format, e.g. 2026-27.");
  });
  it("rejects an end date before the start", () => {
    expect(validateFiscalYear({ ...ok, endDate: "2026-03-31" }).endDate).toBe("End date must be after the start date.");
  });
  it("rejects calendar-year dates unless non-standard is allowed", () => {
    const cal = { ...ok, startDate: "2026-01-01", endDate: "2026-12-31" };
    expect(validateFiscalYear(cal).startDate).toMatch(/starts on 1 April 2026/);
    expect(validateFiscalYear(cal, { nonStandard: true })).toEqual({});
  });
  it("standardFiscalYear(2026) prefills code, label and dates", () => {
    expect(standardFiscalYear(2026)).toEqual(ok);
  });
});
