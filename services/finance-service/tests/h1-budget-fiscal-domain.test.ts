/**
 * Pure-domain checks for the h1-finance-budget-fiscal gap batch:
 *  - GAP-FINANCE-BUDGET-FORMULATION-NEW-02: only expenditure heads are budgetable.
 *  - GAP-FINANCE-FISCAL-YEARS-01: duplicate / overlapping fiscal years rejected.
 */
import { describe, it, expect } from "vitest";
import { assertBudgetableHead, effectiveHeadType } from "../src/modules/budget/domain.js";
import { assertFiscalYearRangeValid, assertOpeningBalancesBalanced } from "../src/modules/masters/domain.js";

describe("assertBudgetableHead (GAP-FINANCE-BUDGET-FORMULATION-NEW-02)", () => {
  it("accepts the seed's level-0 budget heads: revenue 2202, capital 5054", () => {
    expect(() => assertBudgetableHead({ classification: "revenue", code: "2202" })).not.toThrow();
    expect(() => assertBudgetableHead({ classification: "capital", code: "5054" })).not.toThrow();
  });
  it("accepts an unclassified 2xxx head and an explicit expense head", () => {
    expect(() => assertBudgetableHead({ classification: null, code: "2059" })).not.toThrow();
    expect(() => assertBudgetableHead({ classification: "expense", code: "MISC-01" })).not.toThrow();
  });
  it("rejects receipt head 0029 and public-account 8xxx", () => {
    expect(() => assertBudgetableHead({ classification: "revenue", code: "0029" })).toThrow(/expenditure head/);
    expect(() => assertBudgetableHead({ classification: null, code: "8443" })).toThrow(/expenditure head/);
  });
  for (const c of ["asset", "liability", "equity", "income"]) {
    it(`rejects an explicit ${c} head`, () => {
      expect(() => assertBudgetableHead({ classification: c, code: "3054" })).toThrow(/expenditure head/);
    });
  }
  it("accounts-list type agrees with the guard", () => {
    expect(effectiveHeadType("revenue", "2202")).toBe("expense");
    expect(effectiveHeadType(null, "0029")).toBe("income");
    expect(effectiveHeadType(null, "8443")).toBe("liability");
  });
});

describe("assertFiscalYearRangeValid (GAP-FINANCE-FISCAL-YEARS-01)", () => {
  const existing = [
    { code: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" },
    { code: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" },
  ];
  it("accepts the next contiguous year", () => {
    expect(() => assertFiscalYearRangeValid({ code: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31" }, existing)).not.toThrow();
  });
  it("rejects a duplicate code", () => {
    expect(() => assertFiscalYearRangeValid({ code: "2026-27", startDate: "2030-04-01", endDate: "2031-03-31" }, existing))
      .toThrow(expect.objectContaining({ code: "ALREADY_EXISTS" }));
  });
  it("rejects an overlapping range (inclusive boundary)", () => {
    expect(() => assertFiscalYearRangeValid({ code: "2027-28", startDate: "2027-03-31", endDate: "2028-03-30" }, existing))
      .toThrow(expect.objectContaining({ code: "FY_OVERLAP" }));
  });
  it("rejects end <= start", () => {
    expect(() => assertFiscalYearRangeValid({ code: "2030-31", startDate: "2031-03-31", endDate: "2030-04-01" }, existing))
      .toThrow(expect.objectContaining({ code: "FY_INVALID_RANGE" }));
  });
});

describe("assertOpeningBalancesBalanced accepts bigint-safe string paise", () => {
  it("balances exactly above 2^53", () => {
    expect(() => assertOpeningBalancesBalanced([
      { debitMinor: "9007199254740993", creditMinor: "0" },
      { debitMinor: "0", creditMinor: "9007199254740993" },
    ])).not.toThrow();
    expect(() => assertOpeningBalancesBalanced([
      { debitMinor: "9007199254740993", creditMinor: "0" },
      { debitMinor: "0", creditMinor: "9007199254740992" },
    ])).toThrow(/unbalanced/);
  });
});
