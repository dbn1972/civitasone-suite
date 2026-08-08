/**
 * Asset Service — depreciation domain tests. 11 packs.
 */
import { describe, it, expect } from "vitest";
import { slmMonthlyAmount, wdvMonthlyAmount, generatePeriods, computeMonthlyDep } from "../src/modules/depreciation/domain.js";

describe("SLM monthly depreciation", () => {
  it("(cost - salvage) / life / 12", () => {
    const r = slmMonthlyAmount({ acquisitionCostMinor: 1_200_000n, salvageValueMinor: 0n, usefulLifeYears: 10 });
    expect(r).toBe(10_000n); // 1200000 / 10 / 12
  });
  it("zero when salvage >= cost", () => {
    expect(slmMonthlyAmount({ acquisitionCostMinor: 100n, salvageValueMinor: 200n, usefulLifeYears: 5 })).toBe(0n);
  });
});

describe("WDV monthly depreciation", () => {
  it("book_value * rate% / 12 (bigint)", () => {
    const r = wdvMonthlyAmount({ bookValueMinor: 1_000_000n, ratePercent: 15 });
    // 1000000 * 1500 / 120000 = 12500
    expect(r).toBe(12_500n);
  });
  it("zero when book value is zero", () => {
    expect(wdvMonthlyAmount({ bookValueMinor: 0n, ratePercent: 15 })).toBe(0n);
  });
});

describe("computeMonthlyDep — method selector", () => {
  it("SLM method calls slmMonthlyAmount", () => {
    expect(computeMonthlyDep("SLM", 1_200_000n, 0n, 1_000_000n, 10, 15)).toBe(10_000n);
  });
  it("WDV method calls wdvMonthlyAmount", () => {
    expect(computeMonthlyDep("WDV", 1_200_000n, 0n, 1_000_000n, 10, 15)).toBe(12_500n);
  });
});

describe("generatePeriods", () => {
  it("generates monthly periods between two dates", () => {
    const periods = generatePeriods("2026-04-01", "2026-06-30");
    expect(periods).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
  it("single month", () => expect(generatePeriods("2026-07-01", "2026-07-31")).toEqual(["2026-07"]));
  it("crosses year boundary", () => {
    const periods = generatePeriods("2025-11-01", "2026-02-28");
    expect(periods).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});
