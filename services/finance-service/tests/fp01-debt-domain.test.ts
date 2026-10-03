import { describe, it, expect } from "vitest";
import { addMonths, buildEmiSchedule, outstandingFromSchedule, DebtDomainError } from "../src/modules/treasury/debt-domain.js";
import { assertUCWithinSanction, assertUCPeriodValid, assertUCDecidable, assertUCResubmittable } from "../src/modules/payments/uc-domain.js";
import { monthsInRange, openPeriodsOfYear, assertDistinctApprover, assertFiscalYearActivationAllowed, SETTINGS_DEFAULTS } from "../src/modules/approvals/domain.js";

describe("buildEmiSchedule (bigint paise, reducing balance)", () => {
  it("matches the annuity formula to within one paisa per instalment and clears the principal exactly", () => {
    const P = 100_000_000n; // Rs 10,00,000
    const rows = buildEmiSchedule({ principalMinor: P, interestRateBps: 850, tenureMonths: 12, firstEmiDate: "2031-05-31" });
    expect(rows).toHaveLength(12);
    const r = 0.085 / 12;
    const emi = (Number(P) * r * (1 + r) ** 12) / ((1 + r) ** 12 - 1);
    expect(Math.abs(Number(rows[0]!.totalMinor) - emi)).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(rows[5]!.totalMinor) - emi)).toBeLessThanOrEqual(1);
    expect(rows.reduce((a, x) => a + x.principalMinor, 0n)).toBe(P);
    for (const x of rows) expect(x.totalMinor).toBe(x.principalMinor + x.interestMinor);
    // first month's interest is balance * 8.5% / 12
    expect(rows[0]!.interestMinor).toBe(708_333n);
  });

  it("zero interest splits the principal evenly and the last instalment absorbs the remainder", () => {
    const rows = buildEmiSchedule({ principalMinor: 1000n, interestRateBps: 0, tenureMonths: 3, firstEmiDate: "2031-01-15" });
    expect(rows.map((x) => x.principalMinor)).toEqual([333n, 333n, 334n]);
    expect(rows.every((x) => x.interestMinor === 0n)).toBe(true);
  });

  it("handles a principal above 2^53 paise without losing a paisa", () => {
    const P = 9_007_199_254_740_993n;
    const rows = buildEmiSchedule({ principalMinor: P, interestRateBps: 725, tenureMonths: 120, firstEmiDate: "2031-04-01" });
    expect(rows.reduce((a, x) => a + x.principalMinor, 0n)).toBe(P);
  });

  it("never schedules a negative principal part", () => {
    const rows = buildEmiSchedule({ principalMinor: 10n, interestRateBps: 10_000, tenureMonths: 600, firstEmiDate: "2031-04-01" });
    expect(rows.every((x) => x.principalMinor >= 0n && x.interestMinor >= 0n)).toBe(true);
    expect(rows.reduce((a, x) => a + x.principalMinor, 0n)).toBe(10n);
  });

  it("rejects impossible terms", () => {
    const ok = { principalMinor: 1000n, interestRateBps: 500, tenureMonths: 12, firstEmiDate: "2031-04-01" };
    expect(() => buildEmiSchedule({ ...ok, principalMinor: 0n })).toThrow(DebtDomainError);
    expect(() => buildEmiSchedule({ ...ok, tenureMonths: 601 })).toThrow(/tenure/);
    expect(() => buildEmiSchedule({ ...ok, interestRateBps: 10_001 })).toThrow(/rate/);
    expect(() => buildEmiSchedule({ ...ok, tenureMonths: 1.5 })).toThrow(DebtDomainError);
  });

  it("addMonths clamps to the end of a shorter month and crosses years", () => {
    expect(addMonths("2031-01-31", 1)).toBe("2031-02-28");
    expect(addMonths("2032-01-31", 1)).toBe("2032-02-29");
    expect(addMonths("2031-11-15", 3)).toBe("2032-02-15");
    expect(addMonths("2031-03-31", 12)).toBe("2032-03-31");
  });

  it("outstandingFromSchedule sums the principal still due", () => {
    expect(outstandingFromSchedule([
      { principalMinor: 5n, status: "paid" }, { principalMinor: 7n, status: "due" }, { principalMinor: 11n, status: "due" },
    ])).toBe(18n);
  });
});

describe("UC rules", () => {
  it("over-claim: sanctioned 100, already certified 60, new 40 fits, new 41 does not", () => {
    expect(() => assertUCWithinSanction(100n, 60n, 40n)).not.toThrow();
    expect(() => assertUCWithinSanction(100n, 60n, 41n)).toThrow(/UC_OVERCLAIM/);
    expect(() => assertUCWithinSanction(100n, 0n, 0n)).toThrow(/UC_AMOUNT_INVALID/);
  });
  it("period must not run backwards; equal or missing ends are fine", () => {
    expect(() => assertUCPeriodValid("2031-04-02", "2031-04-01")).toThrow(/UC_PERIOD_INVALID/);
    expect(() => assertUCPeriodValid("2031-04-01", "2031-04-01")).not.toThrow();
    expect(() => assertUCPeriodValid(undefined, "2031-04-01")).not.toThrow();
  });
  it("only a submitted UC is decidable and only a rejected one resubmittable", () => {
    expect(() => assertUCDecidable("submitted")).not.toThrow();
    for (const s of ["pending", "verified", "rejected"]) expect(() => assertUCDecidable(s)).toThrow(/UC_NOT_SUBMITTED/);
    expect(() => assertUCResubmittable("rejected")).not.toThrow();
    for (const s of ["pending", "submitted", "verified"]) expect(() => assertUCResubmittable(s)).toThrow(/UC_NOT_REJECTED/);
  });
});

describe("approvals domain", () => {
  it("monthsInRange covers an Indian fiscal year", () => {
    const m = monthsInRange("2031-04-01", "2032-03-31");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2031-04");
    expect(m[11]).toBe("2032-03");
  });
  it("openPeriodsOfYear lists months with no hard-close row, ignoring soft closes", () => {
    const rows = [{ period: "2031-04", status: "hard_close" }, { period: "2031-05", status: "soft_close" }];
    const open = openPeriodsOfYear({ startDate: "2031-04-01", endDate: "2031-06-30" }, rows);
    expect(open).toEqual(["2031-05", "2031-06"]);
  });
  it("assertDistinctApprover only bites when enforcement is on", () => {
    expect(() => assertDistinctApprover("a", "a", true)).toThrow(/MAKER_CHECKER_VIOLATION/);
    expect(() => assertDistinctApprover("a", "a", false)).not.toThrow();
    expect(() => assertDistinctApprover("a", "b", true)).not.toThrow();
  });
  it("activation rules follow the per-tenant settings", () => {
    const outgoing = [{ code: "2031-32", startDate: "2031-04-01", endDate: "2032-03-31" }];
    const base = { targetCode: "2032-33", outgoing, periodRows: [], targetOpeningBalanceCount: 0 };
    expect(() => assertFiscalYearActivationAllowed({ ...base, settings: SETTINGS_DEFAULTS })).toThrow(/FY_OPEN_PERIODS/);
    expect(() => assertFiscalYearActivationAllowed({ ...base, settings: { ...SETTINGS_DEFAULTS, blockFyActivationOpenPeriods: false } })).not.toThrow();
    const strict = { ...SETTINGS_DEFAULTS, blockFyActivationOpenPeriods: false, requireOpeningBalancesForActivation: true };
    expect(() => assertFiscalYearActivationAllowed({ ...base, settings: strict })).toThrow(/FY_OPENING_BALANCES_MISSING/);
    expect(() => assertFiscalYearActivationAllowed({ ...base, outgoing: [], settings: strict })).not.toThrow();
  });
});
