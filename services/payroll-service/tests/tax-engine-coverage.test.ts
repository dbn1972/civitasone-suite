/**
 * Tax engine coverage tests — computeTax, monthlyTds, HRA exemption, true-up.
 */
import { describe, it, expect } from "vitest";
import {
  computeTax, monthlyTdsMinor, hraExemptionMinor, annualTaxFromTaxableMinor,
  monthlyTdsFromTaxableMinor, trueUpTdsMinor, fyStartYearForMonth,
  getTaxConfig, slabsFor, stdDeduction, isTaxConfigLoaded, UnconfiguredFyError,
} from "../src/modules/tax/engine.js";

describe("tax/engine — config registry", () => {
  it("isTaxConfigLoaded returns true after setup", () => {
    expect(isTaxConfigLoaded()).toBe(true);
  });

  it("getTaxConfig returns config for registered regime/year", () => {
    const cfg = getTaxConfig("new", 2025);
    expect(cfg.slabs.length).toBeGreaterThan(0);
    expect(cfg.stdDeduction).toBe(75000);
  });

  it("getTaxConfig throws UnconfiguredFyError for unknown year", () => {
    expect(() => getTaxConfig("new", 1990)).toThrow(UnconfiguredFyError);
  });

  it("slabsFor returns slabs array", () => {
    expect(slabsFor("new", 2025).length).toBeGreaterThan(0);
  });

  it("stdDeduction returns correct value", () => {
    expect(stdDeduction("old", 2025)).toBe(50000);
    expect(stdDeduction("new", 2025)).toBe(75000);
  });
});

describe("tax/engine — computeTax() new regime FY2025", () => {
  it("zero tax below 4L taxable", () => {
    const r = computeTax(300000, "new", 2025);
    expect(r.totalTax).toBe(0);
  });

  it("zero tax at 12L due to 87A rebate", () => {
    // 12L taxable: slab tax = 80000, but rebateIncomeCap=12L → rebate applies
    const r = computeTax(1200000, "new", 2025);
    expect(r.rebate).toBeGreaterThan(0);
    expect(r.totalTax).toBe(0);
  });

  it("positive tax above 12L", () => {
    const r = computeTax(1500000, "new", 2025);
    expect(r.totalTax).toBeGreaterThan(0);
    expect(r.baseTax).toBeGreaterThan(0);
    expect(r.cess).toBeGreaterThan(0);
  });

  it("surcharge kicks in above 50L", () => {
    const r = computeTax(6000000, "new", 2025);
    expect(r.surcharge).toBeGreaterThan(0);
  });

  it("slabBreakdown has entries", () => {
    const r = computeTax(2000000, "new", 2025);
    expect(r.slabBreakdown.length).toBeGreaterThan(0);
  });
});

describe("tax/engine — computeTax() old regime", () => {
  it("zero tax below 2.5L", () => {
    expect(computeTax(200000, "old", 2025).totalTax).toBe(0);
  });

  it("5% slab at 5L", () => {
    const r = computeTax(500000, "old", 2025);
    // 5L taxable, rebate cap 5L → rebate applies
    expect(r.totalTax).toBe(0);
  });

  it("positive tax at 10L", () => {
    const r = computeTax(1000000, "old", 2025);
    expect(r.totalTax).toBeGreaterThan(0);
  });
});

describe("tax/engine — monthlyTdsMinor()", () => {
  it("returns 0 for income below exemption", () => {
    // Annual gross 4L (new regime: 4L - 75K std ded = 3.25L taxable → slab=0)
    expect(monthlyTdsMinor(40000000n, "new", 2025)).toBe(0n);
  });

  it("returns positive for high income", () => {
    // Annual gross 20L
    const tds = monthlyTdsMinor(200000000n, "new", 2025);
    expect(tds).toBeGreaterThan(0n);
  });
});

describe("tax/engine — hraExemptionMinor()", () => {
  it("returns least of 3 legs (metro)", () => {
    const r = hraExemptionMinor(1200000n, 600000n, 480000n, true);
    // a=600000, b=480000-120000=360000, c=600000 (50% metro) → min=360000
    expect(r).toBe(360000n);
  });

  it("uses 40% for non-metro", () => {
    const r = hraExemptionMinor(1200000n, 600000n, 480000n, false);
    // c = 40% of 1200000 = 480000
    expect(r).toBeLessThanOrEqual(480000n);
  });

  it("handles zero rent (b becomes 0)", () => {
    const r = hraExemptionMinor(1200000n, 600000n, 0n, true);
    // b = 0 - 120000 < 0 → clamped to 0 → min is 0
    expect(r).toBe(0n);
  });
});

describe("tax/engine — annualTaxFromTaxableMinor()", () => {
  it("returns tax in paise", () => {
    const tax = annualTaxFromTaxableMinor(150000000n, "new", 2025); // 15L taxable
    expect(tax).toBeGreaterThan(0n);
  });
});

describe("tax/engine — trueUpTdsMinor()", () => {
  it("spreads balance over remaining months", () => {
    const monthly = trueUpTdsMinor(120000n, 60000n, 6);
    expect(monthly).toBe(10000n); // 60000/6 = 10000
  });

  it("deducts full residual in final month", () => {
    const final = trueUpTdsMinor(120000n, 100000n, 1);
    expect(final).toBe(20000n);
  });

  it("returns 0 when already deducted enough", () => {
    expect(trueUpTdsMinor(100000n, 120000n, 3)).toBe(0n);
  });
});

describe("tax/engine — fyStartYearForMonth()", () => {
  it("Apr-Mar FY: 2025-04 → 2025", () => {
    expect(fyStartYearForMonth("2025-04")).toBe(2025);
  });
  it("2026-03 → 2025 (March is still FY2025-26)", () => {
    expect(fyStartYearForMonth("2026-03")).toBe(2025);
  });
  it("2025-01 → 2024 (Jan is FY2024-25)", () => {
    expect(fyStartYearForMonth("2025-01")).toBe(2024);
  });
});
