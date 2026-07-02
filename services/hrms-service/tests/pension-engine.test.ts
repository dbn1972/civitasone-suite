/**
 * Coverage tests for pension/engine.ts (0% → target: 100%).
 * Pure computation engine — no DB or I/O. Tests CCS Pension Rules.
 */
import { describe, it, expect } from "vitest";
import {
  computePension,
  qualifyingService,
  ageAt,
  commutationFactor,
  elEncashment,
  parseNonQualifyingDays,
  summariseNonQualifying,
  MAX_QUALIFYING_HALF_YEARS,
  DCRG_ABSOLUTE_CAP_MINOR,
  FAMILY_PENSION_NORMAL_PCT,
  FAMILY_PENSION_ENHANCED_PCT,
  type PensionInput,
} from "../src/modules/pension/engine.js";

describe("pension/engine — qualifyingService()", () => {
  it("calculates correct months and half-years for 30 years", () => {
    const r = qualifyingService("1990-01-01", "2020-01-01");
    expect(r.grossMonths).toBe(360);
    expect(r.totalMonths).toBe(360);
    expect(r.halfYears).toBe(60); // 30 years = 60 half-years
    expect(r.years).toBeCloseTo(30, 0);
  });

  it("caps half-years at 66 (33 years max)", () => {
    const r = qualifyingService("1985-01-01", "2025-01-01"); // 40 years
    expect(r.halfYears).toBe(MAX_QUALIFYING_HALF_YEARS);
  });

  it("deducts non-qualifying days from total", () => {
    const r = qualifyingService("2000-01-01", "2025-01-01", 365); // 1 year deducted
    expect(r.nonQualifyingDays).toBe(365);
    expect(r.totalMonths).toBeLessThan(r.grossMonths);
  });

  it("returns zero for negative service", () => {
    const r = qualifyingService("2025-01-01", "2020-01-01");
    expect(r.totalMonths).toBe(0);
    expect(r.halfYears).toBe(0);
  });
});

describe("pension/engine — ageAt()", () => {
  it("calculates correct age", () => {
    const r = ageAt("1965-06-15", "2025-06-15");
    expect(r.age).toBe(60);
    expect(r.ageNextBirthday).toBe(61);
  });

  it("handles age before birthday in year", () => {
    const r = ageAt("1965-12-15", "2025-06-01");
    expect(r.age).toBe(59);
    expect(r.ageNextBirthday).toBe(60);
  });
});

describe("pension/engine — commutationFactor()", () => {
  it("returns exact factor for tabulated age", () => {
    expect(commutationFactor(60)).toBe(8.287);
    expect(commutationFactor(61)).toBe(8.194);
    expect(commutationFactor(55)).toBe(8.627);
  });

  it("returns nearest factor for non-tabulated age", () => {
    // Age 75 is not in table; nearest is 70
    const f = commutationFactor(75);
    expect(f).toBe(6.897);
  });

  it("returns nearest for age below table (40)", () => {
    const f = commutationFactor(40);
    expect(f).toBe(9.075); // nearest is 41
  });
});

describe("pension/engine — parseNonQualifyingDays()", () => {
  it("parses days=N format", () => {
    expect(parseNonQualifyingDays("EOL not counting QS; days=180")).toBe(180);
  });

  it("parses from=...;to=... format (inclusive)", () => {
    // 2025-01-01 to 2025-01-31 = 31 days
    expect(parseNonQualifyingDays("from=2025-01-01;to=2025-01-31")).toBe(31);
  });

  it("returns null for unparseable descriptions", () => {
    expect(parseNonQualifyingDays("some random text")).toBeNull();
    expect(parseNonQualifyingDays("")).toBeNull();
  });

  it("handles zero days", () => {
    expect(parseNonQualifyingDays("days=0")).toBe(0);
  });
});

describe("pension/engine — summariseNonQualifying()", () => {
  it("sums only non-qualifying entry types", () => {
    const events = [
      { entryType: "dies_non", effectiveDate: "2025-01-01", description: "days=10" },
      { entryType: "eol_without_qs", effectiveDate: "2025-02-01", description: "days=30" },
      { entryType: "promotion", effectiveDate: "2025-03-01", description: "days=100" }, // not NQ
    ];
    const r = summariseNonQualifying(events);
    expect(r.totalDays).toBe(40);
    expect(r.counted.length).toBe(2);
    expect(r.unparsed.length).toBe(0);
  });

  it("reports unparsed entries", () => {
    const events = [
      { entryType: "suspension_non_duty", effectiveDate: "2025-01-01", description: "no parseable info" },
    ];
    const r = summariseNonQualifying(events);
    expect(r.totalDays).toBe(0);
    expect(r.unparsed.length).toBe(1);
  });
});

describe("pension/engine — computePension() GPF scheme", () => {
  const baseInput: PensionInput = {
    pensionScheme: "GPF",
    dateOfJoining: "1995-01-01",
    retirementDate: "2025-01-01", // 30 years
    lastBasicMinor: 5600000n, // ₹56,000 /month in paise
    daRatePct: 50, // 50% DA
    dateOfBirth: "1965-01-01", // age 60 at retirement
    commutePct: 40,
  };

  it("returns defined-benefit pension for GPF", () => {
    const r = computePension(baseInput);
    expect(r.definedBenefit).toBe(true);
    expect(r.pensionScheme).toBe("GPF");
    expect(r.pensionEligible).toBe(true);
    expect(r.fullPensionEligible).toBe(true);
  });

  it("monthly pension is 50% of average emoluments", () => {
    const r = computePension(baseInput);
    // avg emoluments = lastBasic * (1 + 0.5) = 56000*1.5 = 84000 paise/month... wait
    // 5600000 paise = ₹56,000. With 50% DA => ₹84,000 = 8400000 paise
    // 50% = 4200000 paise/month
    expect(r.monthlyPensionMinor).toBe(4200000n);
  });

  it("uses last_drawn_fallback when avgEmolumentsMinor not provided", () => {
    const r = computePension(baseInput);
    expect(r.avgEmolumentsSource).toBe("last_drawn_fallback");
  });

  it("uses last_10_months when avgEmolumentsMinor is provided", () => {
    const r = computePension({ ...baseInput, avgEmolumentsMinor: 9000000n });
    expect(r.avgEmolumentsSource).toBe("last_10_months");
    // 50% of 9000000 = 4500000
    expect(r.monthlyPensionMinor).toBe(4500000n);
  });

  it("DCRG is correctly calculated and capped", () => {
    const r = computePension(baseInput);
    // halfYears = 60, emoluments = 8400000 paise
    // DCRG raw = 0.25 * 8400000 * 60 = 126000000 paise = ₹12,60,000
    // emolument cap = 16.5 * 8400000 = 138600000
    // absolute cap = 200000000 (₹20,00,000)
    expect(r.dcrg.completedHalfYears).toBe(60);
    expect(r.dcrg.rawMinor).toBe(126000000n);
    expect(r.dcrg.cappedBy).toBe("none");
    expect(r.dcrg.payableMinor).toBe(126000000n);
  });

  it("commutation computes correctly", () => {
    const r = computePension(baseInput);
    expect(r.commutation.commutePct).toBe(40);
    expect(r.commutation.ageNextBirthday).toBe(61);
    expect(r.commutation.factor).toBe(8.194);
    // commuted monthly = 4200000 * 40% = 1680000
    expect(r.commutation.commutedMonthlyPensionMinor).toBe(1680000n);
    // commuted value = 1680000 * 12 * 8.194 ≈ 165,191,040 (rounded)
    expect(r.commutation.commutedValueMinor).toBe(165191040n);
    // residual = 4200000 - 1680000 = 2520000
    expect(r.commutation.residualMonthlyPensionMinor).toBe(2520000n);
  });

  it("family pension computed from last basic", () => {
    const r = computePension(baseInput);
    // normal = 30% of 5600000 = 1680000
    expect(r.familyPension.normalMinor).toBe(1680000n);
    // enhanced = 50% of 5600000 = 2800000
    expect(r.familyPension.enhancedMinor).toBe(2800000n);
  });

  it("no pension for < 10 years qualifying service", () => {
    const r = computePension({
      ...baseInput,
      dateOfJoining: "2020-01-01",
      retirementDate: "2025-01-01", // only 5 years
    });
    expect(r.pensionEligible).toBe(false);
    expect(r.monthlyPensionMinor).toBe(0n);
  });
});

describe("pension/engine — computePension() NPS scheme", () => {
  it("returns no defined-benefit for NPS", () => {
    const r = computePension({
      pensionScheme: "NPS",
      dateOfJoining: "2010-01-01",
      retirementDate: "2040-01-01",
      lastBasicMinor: 5000000n,
      daRatePct: 50,
    });
    expect(r.definedBenefit).toBe(false);
    expect(r.monthlyPensionMinor).toBe(0n);
    expect(r.note).toContain("NPS");
  });

  it("returns no defined-benefit for EPF", () => {
    const r = computePension({
      pensionScheme: "EPF",
      dateOfJoining: "2010-01-01",
      retirementDate: "2040-01-01",
      lastBasicMinor: 3000000n,
      daRatePct: 40,
    });
    expect(r.definedBenefit).toBe(false);
    expect(r.monthlyPensionMinor).toBe(0n);
  });
});

describe("pension/engine — elEncashment()", () => {
  it("calculates EL encashment correctly", () => {
    // (Basic+DA)/30 * days = (56000*1.5)/30 * 300 = 2800 * 300 = 840000 paise
    // In minor units: (5600000 * 1.5) / 30 * 300 = 84000000
    const r = elEncashment(5600000n, 50, 300);
    expect(r).toBe(84000000n);
  });

  it("caps EL encashment at 300 days", () => {
    const r300 = elEncashment(5600000n, 50, 300);
    const r400 = elEncashment(5600000n, 50, 400); // should cap at 300
    expect(r300).toBe(r400);
  });

  it("handles zero balance", () => {
    const r = elEncashment(5600000n, 50, 0);
    expect(r).toBe(0n);
  });
});
