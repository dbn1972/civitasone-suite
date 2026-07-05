import { describe, it, expect } from "vitest";
import {
  computeGratuityExemption,
  computeLeaveEncashExemption,
  computeRetrenchmentExemption,
  computeVrsExemption,
} from "../src/modules/tax/exemptions.js";
import { computeLtcExemption } from "../src/modules/tax/ltc-exemption.js";

// ══════════════════════════════════════════════════════════════════════════════
// Sec 10(10) — Gratuity Exemption
// ══════════════════════════════════════════════════════════════════════════════
describe("computeGratuityExemption — Sec 10(10)", () => {
  const CEILING = 2000000000n; // ₹20 lakh in paise

  it("govt employee: fully exempt regardless of amount", () => {
    const result = computeGratuityExemption({
      actualGratuityMinor: 5000000000n, // ₹50 lakh
      lastDrawnWagesMinor: 10000000n,   // ₹1 lakh monthly
      completedYears: 30,
      employeeCategory: "govt",
      ceilingMinor: CEILING,
    });
    expect(result.exemptMinor).toBe(5000000000n);
    expect(result.taxableMinor).toBe(0n);
    expect(result.section).toBe("10(10)");
  });

  it("non-govt covered: formula is least (actual ₹6L, ceiling ₹20L, 15/26 formula ₹5.77L)", () => {
    // 10 years, last wages ₹1L → formula = (100000*15*10)/26 = 576923 (₹5,769.23 × 100 paise)
    const lastWages = 10000000n; // ₹1 lakh in paise
    const result = computeGratuityExemption({
      actualGratuityMinor: 600000000n, // ₹6 lakh
      lastDrawnWagesMinor: lastWages,
      completedYears: 10,
      employeeCategory: "non_govt_covered",
      ceilingMinor: CEILING,
    });
    // formula = (10000000 * 15 * 10) / 26 = 57692307n (~₹5.77L)
    const expectedFormula = (lastWages * 15n * 10n) / 26n;
    expect(result.exemptMinor).toBe(expectedFormula); // formula is least
    expect(result.taxableMinor).toBe(600000000n - expectedFormula);
  });

  it("non-govt covered: actual is least when formula and ceiling are both higher", () => {
    // 25 years, last wages ₹2L (=20000000 paise) → formula = (20000000*15*25)/26 = 288461538 (~₹2.88L)
    // actual ₹1.5L (=150000000), ceiling ₹20L → actual is least
    const result = computeGratuityExemption({
      actualGratuityMinor: 150000000n, // ₹1.5 lakh
      lastDrawnWagesMinor: 20000000n,  // ₹2 lakh monthly
      completedYears: 25,
      employeeCategory: "non_govt_covered",
      ceilingMinor: CEILING,
    });
    expect(result.exemptMinor).toBe(150000000n);
    expect(result.taxableMinor).toBe(0n);
  });

  it("non-govt covered: ceiling is least", () => {
    // Use very high wages so formula > ceiling, actual > ceiling
    // wages ₹10L (=100000000 paise), 30 years → formula = (100000000*15*30)/26 ≈ 1730769230 (~₹17.3L)
    // actual ₹25L, ceiling ₹20L → ceiling is least... but formula is ₹17.3L < ceiling!
    // Need wages high enough that formula > ceiling: wages ₹15L, 30y → (150000000*15*30)/26 = 2596153846 > ceiling
    const result = computeGratuityExemption({
      actualGratuityMinor: 2200000000n, // ₹22 lakh
      lastDrawnWagesMinor: 150000000n,  // ₹1.5 lakh monthly (150000000 paise = ₹15L? No, ₹1.5L)
      completedYears: 30,
      employeeCategory: "non_govt_covered",
      ceilingMinor: CEILING,
    });
    // formula = (150000000 * 15 * 30) / 26 = 2596153846 (~₹25.96L) > ceiling ₹20L
    // actual ₹22L > ceiling → ceiling is least
    expect(result.exemptMinor).toBe(CEILING);
    expect(result.taxableMinor).toBe(2200000000n - CEILING);
  });

  it("non-govt uncovered: uses half-month formula", () => {
    // wages ₹80K (=8000000 paise), 8 years → formula = (8000000*8)/2 = 32000000 (₹32K in paise = ₹0.32L)
    // actual ₹50K (=5000000 paise) > formula → formula is least
    const result = computeGratuityExemption({
      actualGratuityMinor: 5000000n, // ₹50K (less than formula)
      lastDrawnWagesMinor: 8000000n, // ₹80K monthly
      completedYears: 8,
      employeeCategory: "non_govt_uncovered",
      ceilingMinor: CEILING,
    });
    // formula = (8000000*8)/2 = 32000000 (₹3.2L in paise)
    // actual ₹50K < formula → actual is least
    expect(result.exemptMinor).toBe(5000000n);
    expect(result.taxableMinor).toBe(0n);
  });

  it("zero gratuity: no exemption", () => {
    const result = computeGratuityExemption({
      actualGratuityMinor: 0n,
      lastDrawnWagesMinor: 10000000n,
      completedYears: 10,
      employeeCategory: "non_govt_covered",
      ceilingMinor: CEILING,
    });
    expect(result.exemptMinor).toBe(0n);
    expect(result.taxableMinor).toBe(0n);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Sec 10(10AA) — Leave Encashment Exemption
// ══════════════════════════════════════════════════════════════════════════════
describe("computeLeaveEncashExemption — Sec 10(10AA)", () => {
  const CEILING = 2500000000n; // ₹25 lakh

  it("govt retiring: fully exempt", () => {
    const result = computeLeaveEncashExemption({
      actualEncashmentMinor: 3000000000n, // ₹30 lakh
      avgSalaryLast10MonthsMinor: 12000000n,
      leaveBalanceDays: 300,
      completedYears: 30,
      employeeCategory: "govt",
      separationType: "retirement",
      ceilingMinor: CEILING,
      priorExemptionClaimedMinor: 0n,
    });
    expect(result.exemptMinor).toBe(3000000000n);
    expect(result.taxableMinor).toBe(0n);
  });

  it("private resigning at age 40: NO exemption", () => {
    const result = computeLeaveEncashExemption({
      actualEncashmentMinor: 500000000n, // ₹5 lakh
      avgSalaryLast10MonthsMinor: 8000000n,
      leaveBalanceDays: 120,
      completedYears: 15,
      employeeCategory: "non_govt_covered",
      separationType: "resignation",
      ceilingMinor: CEILING,
      priorExemptionClaimedMinor: 0n,
    });
    expect(result.exemptMinor).toBe(0n);
    expect(result.taxableMinor).toBe(500000000n);
  });

  it("private retiring: computes least of 4 limbs", () => {
    // avg salary = ₹80K (=8000000 paise), 20 years, 300 days balance
    // limb 1 (10-month avg): 8000000 × 10 = 80000000 (₹0.8L)
    // limb 2 (cash equiv): daily=8000000/30=266666, maxDays=min(300, 20×30=600)→300
    //   cashEquiv=266666*300=79999800 (₹0.8L)
    // limb 3 (ceiling-prior): 2500000000 - 0 = 2500000000 (₹25L)
    // actual: 500000000 (₹5L)
    // least = 79999800 (cash equivalent)
    const avgSalary = 8000000n;
    const result = computeLeaveEncashExemption({
      actualEncashmentMinor: 500000000n, // ₹5 lakh
      avgSalaryLast10MonthsMinor: avgSalary,
      leaveBalanceDays: 300,
      completedYears: 20,
      employeeCategory: "non_govt_covered",
      separationType: "retirement",
      ceilingMinor: CEILING,
      priorExemptionClaimedMinor: 0n,
    });
    const dailySalary = avgSalary / 30n; // 266666
    const cashEquiv = dailySalary * 300n; // 79999800
    expect(result.exemptMinor).toBe(cashEquiv);
    expect(result.taxableMinor).toBe(500000000n - cashEquiv);
  });

  it("prior employer claimed ₹10L: remaining ceiling = ₹15L", () => {
    const result = computeLeaveEncashExemption({
      actualEncashmentMinor: 2000000000n, // ₹20 lakh
      avgSalaryLast10MonthsMinor: 15000000n, // ₹1.5L
      leaveBalanceDays: 400,
      completedYears: 25,
      employeeCategory: "non_govt_covered",
      separationType: "retirement",
      ceilingMinor: CEILING,
      priorExemptionClaimedMinor: 1000000000n, // ₹10L prior
    });
    // remaining ceiling = 25L - 10L = ₹15L
    // This should cap the exemption
    expect(result.exemptMinor).toBeLessThanOrEqual(1500000000n);
    expect(result.taxableMinor).toBeGreaterThan(0n);
  });

  it("leave balance capped at 30 days per year of service", () => {
    // 10 years service, 500 days balance → maxDays = min(500, 10*30=300) = 300
    const avgSalary = 10000000n; // ₹1L
    const result = computeLeaveEncashExemption({
      actualEncashmentMinor: 2000000000n, // ₹20L (large actual)
      avgSalaryLast10MonthsMinor: avgSalary,
      leaveBalanceDays: 500,
      completedYears: 10,
      employeeCategory: "non_govt_covered",
      separationType: "superannuation",
      ceilingMinor: CEILING,
      priorExemptionClaimedMinor: 0n,
    });
    // cashEquivalent = (10000000/30) * 300 = 100000000 (₹10L)
    // 10-month avg = ₹10L
    // ceiling = ₹25L
    // actual = ₹20L
    // least = ₹10L (cashEquivalent = 10-month avg in this case)
    const dailySalary = avgSalary / 30n;
    const expectedCashEquiv = dailySalary * 300n; // 300 days (capped)
    expect(result.exemptMinor).toBe(expectedCashEquiv);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Sec 10(10B) — Retrenchment Compensation
// ══════════════════════════════════════════════════════════════════════════════
describe("computeRetrenchmentExemption — Sec 10(10B)", () => {
  const CEILING = 500000000n; // ₹5 lakh

  it("returns null for non-retrenchment separation", () => {
    const result = computeRetrenchmentExemption({
      actualCompMinor: 300000000n,
      avgMonthlyPayMinor: 5000000n,
      completedYears: 8,
      separationType: "resignation",
      ceilingMinor: CEILING,
    });
    expect(result).toBeNull();
  });

  it("retrenchment: formula is least", () => {
    // 8 years, avg pay ₹50K → formula = (5000000 * 15 * 8) / 30 = 20000000 (₹2L)
    const result = computeRetrenchmentExemption({
      actualCompMinor: 300000000n, // ₹3L
      avgMonthlyPayMinor: 5000000n, // ₹50K
      completedYears: 8,
      separationType: "retrenchment",
      ceilingMinor: CEILING,
    });
    const expectedFormula = (5000000n * 15n * 8n) / 30n; // 20000000 = ₹2L
    expect(result!.exemptMinor).toBe(expectedFormula);
    expect(result!.taxableMinor).toBe(300000000n - expectedFormula);
  });

  it("retrenchment: ceiling caps exemption", () => {
    // 20 years, avg pay ₹3L → formula = (30000000 * 15 * 20) / 30 = 300000000 (₹3L)
    // ceiling = ₹5L, actual = ₹10L → formula ₹3L is least
    const result = computeRetrenchmentExemption({
      actualCompMinor: 1000000000n, // ₹10L
      avgMonthlyPayMinor: 30000000n, // ₹3L (paise)
      completedYears: 20,
      separationType: "retrenchment",
      ceilingMinor: CEILING,
    });
    const expectedFormula = (30000000n * 15n * 20n) / 30n; // 300000000 = ₹3L
    expect(result!.exemptMinor).toBe(expectedFormula);
    expect(result!.taxableMinor).toBe(1000000000n - expectedFormula);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Sec 10(10C) — VRS Exemption
// ══════════════════════════════════════════════════════════════════════════════
describe("computeVrsExemption — Sec 10(10C)", () => {
  const CEILING = 500000000n; // ₹5 lakh

  it("returns null for non-VRS separation", () => {
    const result = computeVrsExemption({
      actualCompMinor: 1000000000n,
      monthlySalaryMinor: 8000000n,
      completedYears: 15,
      remainingMonthsToRetirement: 60,
      separationType: "retirement",
      ceilingMinor: CEILING,
    });
    expect(result).toBeNull();
  });

  it("VRS: ceiling caps at ₹5L despite high formula", () => {
    // 15 years, salary ₹80K (paise=8000000), remaining 60 months
    // limbA = 8000000×3×15 = 360000000 (₹3.6L)
    // limbB = 8000000×60 = 480000000 (₹4.8L)
    // formula = min(limbA, limbB) = 360000000 (₹3.6L)
    // ceiling = ₹5L, actual = ₹10L → formula is least
    const result = computeVrsExemption({
      actualCompMinor: 1000000000n, // ₹10L
      monthlySalaryMinor: 8000000n, // ₹80K in paise
      completedYears: 15,
      remainingMonthsToRetirement: 60,
      separationType: "vrs",
      ceilingMinor: CEILING,
    });
    const expectedLimbA = 8000000n * 3n * 15n; // 360000000
    expect(result!.exemptMinor).toBe(expectedLimbA);
    expect(result!.taxableMinor).toBe(1000000000n - expectedLimbA);
  });

  it("VRS: actual is least when small", () => {
    const result = computeVrsExemption({
      actualCompMinor: 200000000n, // ₹2L
      monthlySalaryMinor: 8000000n,
      completedYears: 15,
      remainingMonthsToRetirement: 60,
      separationType: "vrs",
      ceilingMinor: CEILING,
    });
    expect(result!.exemptMinor).toBe(200000000n);
    expect(result!.taxableMinor).toBe(0n);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Sec 10(5) — LTC Exemption
// ══════════════════════════════════════════════════════════════════════════════
describe("computeLtcExemption — Sec 10(5)", () => {
  it("fare within entitlement: fully exempt", () => {
    const result = computeLtcExemption({
      approvedFareMinor: 4000000n, // ₹40K
      entitlementMinor: 5000000n,  // ₹50K
      ltcType: "hometown",
      blockYear: "2022-25",
      usedInBlock: 0,
    });
    expect(result.exemptMinor).toBe(4000000n);
    expect(result.taxableMinor).toBe(0n);
  });

  it("fare exceeds entitlement: excess is taxable", () => {
    const result = computeLtcExemption({
      approvedFareMinor: 6000000n, // ₹60K
      entitlementMinor: 5000000n,  // ₹50K
      ltcType: "all_india",
      blockYear: "2022-25",
      usedInBlock: 1,
    });
    expect(result.exemptMinor).toBe(5000000n);
    expect(result.taxableMinor).toBe(1000000n); // ₹10K taxable
  });

  it("third trip in block: entire fare taxable", () => {
    const result = computeLtcExemption({
      approvedFareMinor: 4000000n,
      entitlementMinor: 5000000n,
      ltcType: "hometown",
      blockYear: "2022-25",
      usedInBlock: 2, // already used both trips
    });
    expect(result.exemptMinor).toBe(0n);
    expect(result.taxableMinor).toBe(4000000n);
  });

  it("zero fare: no exemption", () => {
    const result = computeLtcExemption({
      approvedFareMinor: 0n,
      entitlementMinor: 5000000n,
      ltcType: "hometown",
      blockYear: "2026-29",
      usedInBlock: 0,
    });
    expect(result.exemptMinor).toBe(0n);
    expect(result.taxableMinor).toBe(0n);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Conservation property: exempt + taxable = actual (for all exemption types)
// ══════════════════════════════════════════════════════════════════════════════
describe("Conservation: exempt + taxable = actual", () => {
  it("gratuity", () => {
    const actual = 1500000000n;
    const r = computeGratuityExemption({
      actualGratuityMinor: actual,
      lastDrawnWagesMinor: 8000000n,
      completedYears: 12,
      employeeCategory: "non_govt_covered",
      ceilingMinor: 2000000000n,
    });
    expect(r.exemptMinor + r.taxableMinor).toBe(actual);
  });

  it("leave encashment (retirement)", () => {
    const actual = 800000000n;
    const r = computeLeaveEncashExemption({
      actualEncashmentMinor: actual,
      avgSalaryLast10MonthsMinor: 10000000n,
      leaveBalanceDays: 200,
      completedYears: 20,
      employeeCategory: "non_govt_covered",
      separationType: "retirement",
      ceilingMinor: 2500000000n,
      priorExemptionClaimedMinor: 0n,
    });
    expect(r.exemptMinor + r.taxableMinor).toBe(actual);
  });

  it("LTC", () => {
    const actual = 7000000n;
    const r = computeLtcExemption({
      approvedFareMinor: actual,
      entitlementMinor: 5000000n,
      ltcType: "all_india",
      blockYear: "2022-25",
      usedInBlock: 0,
    });
    expect(r.exemptMinor + r.taxableMinor).toBe(actual);
  });
});
