import { describe, it, expect } from "vitest";
import { ALL_PERIODS, distinctPeriods, mayBeTruncated, periodSortKey, resolvePeriod, sumSlips } from "./slipPeriods";

describe("slipPeriods (GAP-PAYROLL-SALARY-SLIPS-02/03)", () => {
  it("sorts display-label periods chronologically, newest first, across a year boundary", () => {
    const slips = [{ payPeriod: "Dec 2025" }, { payPeriod: "Feb 2026" }, { payPeriod: "Jan 2026" }, { payPeriod: "Feb 2026" }];
    expect(distinctPeriods(slips)).toEqual(["Feb 2026", "Jan 2026", "Dec 2025"]);
    expect(periodSortKey("2026-08")).toBe(202608);
    expect(periodSortKey("garbage")).toBe(0);
  });
  it("defaults to the newest period, honours a valid request and 'all', ignores an unknown one", () => {
    const p = ["Feb 2026", "Jan 2026"];
    expect(resolvePeriod(undefined, p)).toBe("Feb 2026");
    expect(resolvePeriod("Jan 2026", p)).toBe("Jan 2026");
    expect(resolvePeriod(ALL_PERIODS, p)).toBe(ALL_PERIODS);
    expect(resolvePeriod("Mar 2030", p)).toBe("Feb 2026");
    expect(resolvePeriod(undefined, [])).toBe(ALL_PERIODS);
  });
  it("sums money as bigint paise", () => {
    const t = sumSlips([{ gross: 10000, net: 8000 }, { gross: 5, net: 3 }]);
    expect(t).toEqual({ count: 2, grossMinor: 10005n, netMinor: 8003n });
  });
  it("treats a full page as possibly truncated", () => {
    expect(mayBeTruncated(499)).toBe(false);
    expect(mayBeTruncated(500)).toBe(true);
  });
});
