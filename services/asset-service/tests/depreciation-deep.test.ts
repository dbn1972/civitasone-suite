/**
 * Asset Service — Depreciation: Deep domain + validator tests.
 *
 * Tests exact-money arithmetic (bigint paise), SLM and WDV calculations,
 * period generation, boundary conditions, and input validation.
 *
 * Source: modules/depreciation/domain.ts, modules/depreciation/validators.ts
 */
import { describe, it, expect } from "vitest";
import {
  slmMonthlyAmount,
  wdvMonthlyAmount,
  computeMonthlyDep,
  generatePeriods,
  DomainError,
} from "../src/modules/depreciation/domain.js";
import {
  createDepScheduleBody,
  runDepBody,
  assetIdParam,
} from "../src/modules/depreciation/validators.js";

// ═══ SLM (Straight-Line Method) ═══

describe("slmMonthlyAmount — exact money arithmetic", () => {
  it("basic calculation: (cost - salvage) / life / 12", () => {
    // ₹10,00,000 asset, ₹1,00,000 salvage, 10 years
    // Monthly = (10_00_000 - 1_00_000) * 100 / 10 / 12 = 9_00_000 * 100 / 120 = 750000 paise = ₹7,500/mo
    const result = slmMonthlyAmount({
      acquisitionCostMinor: 100000000n, // ₹10,00,000 in paise
      salvageValueMinor: 10000000n,     // ₹1,00,000 in paise
      usefulLifeYears: 10,
    });
    expect(result).toBe(750000n); // ₹7,500 per month
  });

  it("zero depreciable amount returns 0", () => {
    expect(slmMonthlyAmount({
      acquisitionCostMinor: 100000n,
      salvageValueMinor: 100000n, // cost = salvage
      usefulLifeYears: 5,
    })).toBe(0n);
  });

  it("negative depreciable returns 0 (salvage > cost)", () => {
    expect(slmMonthlyAmount({
      acquisitionCostMinor: 50000n,
      salvageValueMinor: 100000n,
      usefulLifeYears: 5,
    })).toBe(0n);
  });

  it("short useful life (1 year)", () => {
    // ₹12,000 - ₹0 / 1 / 12 = ₹1,000/mo = 100000 paise
    expect(slmMonthlyAmount({
      acquisitionCostMinor: 1200000n,
      salvageValueMinor: 0n,
      usefulLifeYears: 1,
    })).toBe(100000n);
  });

  it("integer division truncates (no rounding error propagation)", () => {
    // ₹10,001 / 3 years / 12 months = 10001*100 / 36 = 27780.5... → truncated to 27780
    const result = slmMonthlyAmount({
      acquisitionCostMinor: 1000100n,
      salvageValueMinor: 0n,
      usefulLifeYears: 3,
    });
    // 1000100 / 3 = 333366n, /12 = 27780n
    expect(result).toBe(27780n);
  });

  it("large asset value (₹10 crore = ₹10,00,00,000)", () => {
    const result = slmMonthlyAmount({
      acquisitionCostMinor: 10000000000n, // 10 crore in paise
      salvageValueMinor: 1000000000n,     // 1 crore
      usefulLifeYears: 20,
    });
    // (10cr - 1cr) / 20 / 12 = 9cr / 240 = 3750000 paise = ₹37,500/mo
    expect(result).toBe(37500000n);
  });
});

// ═══ WDV (Written Down Value) ═══

describe("wdvMonthlyAmount — declining balance", () => {
  it("basic WDV: bookValue * rate% / 12", () => {
    // Book value ₹5,00,000, rate 15%
    // Monthly = 50000000 * 1500 / 120000 = 625000 paise = ₹6,250/mo
    const result = wdvMonthlyAmount({
      bookValueMinor: 50000000n,
      ratePercent: 15,
    });
    expect(result).toBe(625000n);
  });

  it("zero book value returns 0", () => {
    expect(wdvMonthlyAmount({ bookValueMinor: 0n, ratePercent: 15 })).toBe(0n);
  });

  it("negative book value returns 0", () => {
    expect(wdvMonthlyAmount({ bookValueMinor: -100n, ratePercent: 15 })).toBe(0n);
  });

  it("fractional rate (7.5%)", () => {
    // 10000000 * 750 / 120000 = 62500
    const result = wdvMonthlyAmount({ bookValueMinor: 10000000n, ratePercent: 7.5 });
    expect(result).toBe(62500n);
  });

  it("100% rate depreciates fully in one year", () => {
    // 1200000 * 10000 / 120000 = 100000 per month
    const result = wdvMonthlyAmount({ bookValueMinor: 1200000n, ratePercent: 100 });
    expect(result).toBe(100000n);
  });
});

// ═══ computeMonthlyDep — method dispatch ═══

describe("computeMonthlyDep — method routing", () => {
  it("uses SLM when method is SLM", () => {
    const result = computeMonthlyDep("SLM", 1200000n, 0n, 1200000n, 1, 0);
    expect(result).toBe(100000n); // same as slmMonthlyAmount
  });

  it("uses WDV when method is WDV", () => {
    const result = computeMonthlyDep("WDV", 0n, 0n, 50000000n, 0, 15);
    expect(result).toBe(625000n); // same as wdvMonthlyAmount
  });
});

// ═══ generatePeriods ═══

describe("generatePeriods — monthly period list", () => {
  it("single month range", () => {
    expect(generatePeriods("2026-07-01", "2026-07-31")).toEqual(["2026-07"]);
  });

  it("3 months within same year", () => {
    expect(generatePeriods("2026-04-01", "2026-06-30")).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("crosses year boundary", () => {
    expect(generatePeriods("2025-11-01", "2026-02-28")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("full fiscal year (Apr-Mar)", () => {
    const periods = generatePeriods("2025-04-01", "2026-03-31");
    expect(periods).toHaveLength(12);
    expect(periods[0]).toBe("2025-04");
    expect(periods[11]).toBe("2026-03");
  });

  it("same month start and end", () => {
    expect(generatePeriods("2026-01-15", "2026-01-15")).toEqual(["2026-01"]);
  });
});

// ═══ Validators ═══

describe("createDepScheduleBody — schedule creation", () => {
  it("accepts SLM", () => {
    expect(createDepScheduleBody.safeParse({ method: "SLM", startDate: "2026-04-01" }).success).toBe(true);
  });

  it("accepts WDV", () => {
    expect(createDepScheduleBody.safeParse({ method: "WDV", startDate: "2026-04-01" }).success).toBe(true);
  });

  it("rejects unknown method", () => {
    expect(createDepScheduleBody.safeParse({ method: "MACRS", startDate: "2026-04-01" }).success).toBe(false);
  });

  it("rejects invalid date format", () => {
    expect(createDepScheduleBody.safeParse({ method: "SLM", startDate: "2026" }).success).toBe(false);
  });
});

describe("runDepBody — depreciation run", () => {
  it("accepts valid period", () => {
    expect(runDepBody.safeParse({ period: "2026-07" }).success).toBe(true);
  });

  it("accepts depBook values", () => {
    for (const book of ["company", "statutory", "all"]) {
      expect(runDepBody.safeParse({ period: "2026-07", depBook: book }).success).toBe(true);
    }
  });

  it("rejects invalid period format", () => {
    expect(runDepBody.safeParse({ period: "2026-07-01" }).success).toBe(false);
    expect(runDepBody.safeParse({ period: "Jul 2026" }).success).toBe(false);
  });

  it("rejects invalid depBook", () => {
    expect(runDepBody.safeParse({ period: "2026-07", depBook: "tax" }).success).toBe(false);
  });

  it("defaults depBook to all", () => {
    const result = runDepBody.safeParse({ period: "2026-07" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.depBook).toBe("all");
  });
});

describe("assetIdParam", () => {
  it("accepts valid UUID", () => {
    expect(assetIdParam.safeParse({ id: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true);
  });
  it("rejects non-UUID", () => {
    expect(assetIdParam.safeParse({ id: "bad" }).success).toBe(false);
  });
});
