import { describe, it, expect } from "vitest";
import { computeFnfSettlement, type FnfInput } from "../src/modules/fnf/domain.js";

/**
 * Unit tests for the F&F Settlement domain function `computeFnfSettlement`.
 * All amounts in paise (bigint). Tax config for FY 2024 new regime is loaded
 * via the vitest setupFiles (setup-tax-config.ts).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a base FnfInput with sensible defaults; override fields as needed. */
function baseFnfInput(overrides: Partial<FnfInput> = {}): FnfInput {
  return {
    employeeId: "emp-001",
    tenantId: "tenant-001",
    separationType: "retirement",
    separationDate: "2025-01-31",
    employeeCategory: "non_govt_covered",
    noticeBuyoutMinor: 0n,
    leaveEncashmentGrossMinor: 0n,
    gratuityGrossMinor: 0n,
    retrenchmentCompMinor: 0n,
    vrsCompMinor: 0n,
    arrearsMinor: 0n,
    lastDrawnWagesMinor: 0n,
    completedYears: 0,
    avgSalaryLast10MonthsMinor: 0n,
    leaveBalanceDays: 0,
    priorLeaveEncashExemptionMinor: 0n,
    remainingMonthsToRetirement: 0,
    taxRegime: "new",
    salaryYtdMinor: 0n,
    tdsYtdMinor: 0n,
    deductions80cMinor: 0n,
    deductions80dMinor: 0n,
    otherDeductionsMinor: 0n,
    fyStartYear: 2024,
    gratuityCeilingMinor: 2000000000n, // ₹20L
    leaveEncashCeilingMinor: 2500000000n, // ₹25L
    retrenchmentCeilingMinor: 500000000n, // ₹5L
    vrsCeilingMinor: 500000000n, // ₹5L
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Test 1: Govt employee retiring after 30 years → TDS only on notice buyout
// ══════════════════════════════════════════════════════════════════════════════
describe("computeFnfSettlement — Govt employee retiring after 30 years", () => {
  it("gratuity + leave encashment fully exempt, TDS only on notice buyout", () => {
    const input = baseFnfInput({
      employeeCategory: "govt",
      separationType: "retirement",
      completedYears: 30,
      // Gratuity: ₹20L
      gratuityGrossMinor: 2000000000n,
      lastDrawnWagesMinor: 15000000n, // ₹1.5L monthly basic+DA
      // Leave encashment: ₹10L
      leaveEncashmentGrossMinor: 1000000000n,
      avgSalaryLast10MonthsMinor: 12000000n, // ₹1.2L
      leaveBalanceDays: 300,
      // Notice buyout: ₹3L (always fully taxable)
      noticeBuyoutMinor: 300000000n,
      // Salary YTD ₹15L (April-Jan = 10 months × ₹1.5L)
      salaryYtdMinor: 1500000000n,
      tdsYtdMinor: 50000000n, // ₹50K TDS already paid
      taxRegime: "new",
      fyStartYear: 2024,
    });

    const result = computeFnfSettlement(input);

    // Govt: gratuity fully exempt
    expect(result.gratuityExemption.exemptMinor).toBe(2000000000n);
    expect(result.gratuityExemption.taxableMinor).toBe(0n);

    // Govt: leave encashment fully exempt
    expect(result.leaveEncashExemption.exemptMinor).toBe(1000000000n);
    expect(result.leaveEncashExemption.taxableMinor).toBe(0n);

    // Total exempt = gratuity + leave encashment
    expect(result.totalExemptMinor).toBe(3000000000n);

    // Taxable on separation = notice buyout only (₹3L)
    expect(result.totalTaxableOnSeparationMinor).toBe(300000000n);

    // TDS on separation should be >= 0 (computed via tax engine)
    expect(result.tdsOnSeparationMinor).toBeGreaterThanOrEqual(0n);

    // Net payable = totalGross - tdsOnSeparation
    expect(result.netPayableMinor).toBe(result.totalGrossMinor - result.tdsOnSeparationMinor);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Test 2: Private employee resigning after 3 years → no gratuity, leave taxable
// ══════════════════════════════════════════════════════════════════════════════
describe("computeFnfSettlement — Private employee resigning after 3 years", () => {
  it("gratuity = 0 (ineligible), leave encashment fully taxable (resignation)", () => {
    const input = baseFnfInput({
      employeeCategory: "non_govt_covered",
      separationType: "resignation",
      completedYears: 3,
      // No gratuity paid (ineligible under PG Act < 5 years)
      gratuityGrossMinor: 0n,
      lastDrawnWagesMinor: 8000000n, // ₹80K monthly
      // Leave encashment: ₹2L
      leaveEncashmentGrossMinor: 200000000n,
      avgSalaryLast10MonthsMinor: 8000000n,
      leaveBalanceDays: 45,
      // Arrears: ₹50K
      arrearsMinor: 5000000n,
      // Salary YTD ₹4.8L (6 months × ₹80K)
      salaryYtdMinor: 480000000n,
      tdsYtdMinor: 0n, // No TDS deducted yet (below tax threshold)
      taxRegime: "new",
      fyStartYear: 2024,
    });

    const result = computeFnfSettlement(input);

    // Gratuity: 0 gross → 0 exempt, 0 taxable
    expect(result.gratuityExemption.exemptMinor).toBe(0n);
    expect(result.gratuityExemption.taxableMinor).toBe(0n);

    // Leave encashment: resignation → NO exemption, fully taxable
    expect(result.leaveEncashExemption.exemptMinor).toBe(0n);
    expect(result.leaveEncashExemption.taxableMinor).toBe(200000000n);

    // Total exempt = 0
    expect(result.totalExemptMinor).toBe(0n);

    // Taxable on separation = leave encashment + arrears
    expect(result.totalTaxableOnSeparationMinor).toBe(200000000n + 5000000n);

    // Net payable check
    expect(result.netPayableMinor).toBe(result.totalGrossMinor - result.tdsOnSeparationMinor);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Test 3: Private employee retiring after 20 years → partial exemptions, TDS true-up
// ══════════════════════════════════════════════════════════════════════════════
describe("computeFnfSettlement — Private employee retiring after 20 years", () => {
  it("partial exemptions on gratuity and leave, TDS true-up is correct", () => {
    const lastDrawnWages = 12000000n; // ₹1.2L monthly basic+DA
    const avgSalary10Mo = 11000000n;  // ₹1.1L average last 10 months

    const input = baseFnfInput({
      employeeCategory: "non_govt_covered",
      separationType: "retirement",
      completedYears: 20,
      // Gratuity: ₹15L
      gratuityGrossMinor: 1500000000n,
      lastDrawnWagesMinor: lastDrawnWages,
      // Leave encashment: ₹8L
      leaveEncashmentGrossMinor: 800000000n,
      avgSalaryLast10MonthsMinor: avgSalary10Mo,
      leaveBalanceDays: 240,
      priorLeaveEncashExemptionMinor: 0n,
      // Salary YTD ₹12L (10 months × ₹1.2L)
      salaryYtdMinor: 1200000000n,
      tdsYtdMinor: 80000000n, // ₹80K TDS already deducted
      taxRegime: "new",
      fyStartYear: 2024,
    });

    const result = computeFnfSettlement(input);

    // Gratuity exemption: formula = (12000000 * 15 * 20) / 26 = 138461538n (~₹13.85L)
    // LEAST(actual ₹15L, ceiling ₹20L, formula ~₹13.85L) = formula
    const expectedGratuityFormula = (lastDrawnWages * 15n * 20n) / 26n;
    expect(result.gratuityExemption.exemptMinor).toBe(expectedGratuityFormula);
    expect(result.gratuityExemption.taxableMinor).toBe(1500000000n - expectedGratuityFormula);

    // Leave encashment: retirement → exemption applies
    // 10-month avg = 11000000 × 10 = 110000000 (₹1.1L × 10 = ₹11L)
    // cashEquiv = (11000000/30) × min(240, 20×30=600) → (366666) × 240 = 87999840
    // ceiling−prior = 2500000000 - 0 = 2500000000
    // actual = 800000000
    // LEAST = cashEquiv (87999840) since it's smallest
    const dailySalary = avgSalary10Mo / 30n;
    const maxDays = Math.min(240, 20 * 30);
    const cashEquiv = dailySalary * BigInt(maxDays);
    const tenMonthAvg = avgSalary10Mo * 10n;
    // LEAST of (actual, ceiling, tenMonthAvg, cashEquiv)
    const expectedLeaveExempt = [800000000n, 2500000000n, tenMonthAvg, cashEquiv]
      .reduce((min, v) => v < min ? v : min);
    expect(result.leaveEncashExemption.exemptMinor).toBe(expectedLeaveExempt);
    expect(result.leaveEncashExemption.taxableMinor).toBe(800000000n - expectedLeaveExempt);

    // TDS true-up: tdsOnSeparation = annualTax - tdsYtd (clamped to 0)
    expect(result.tdsOnSeparationMinor).toBe(
      result.annualTaxMinor > 80000000n
        ? result.annualTaxMinor - 80000000n
        : 0n
    );

    // Net payable
    expect(result.netPayableMinor).toBe(result.totalGrossMinor - result.tdsOnSeparationMinor);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Test 4: Conservation property — exempt + taxable = gross for each component
// ══════════════════════════════════════════════════════════════════════════════
describe("computeFnfSettlement — Conservation: exempt + taxable = gross", () => {
  it("totalExempt + totalTaxableOnSeparation = totalGross for all components", () => {
    const input = baseFnfInput({
      employeeCategory: "non_govt_covered",
      separationType: "retirement",
      completedYears: 15,
      gratuityGrossMinor: 1000000000n,  // ₹10L
      lastDrawnWagesMinor: 10000000n,   // ₹1L
      leaveEncashmentGrossMinor: 500000000n, // ₹5L
      avgSalaryLast10MonthsMinor: 9000000n,
      leaveBalanceDays: 180,
      noticeBuyoutMinor: 200000000n,    // ₹2L
      arrearsMinor: 100000000n,         // ₹1L
      salaryYtdMinor: 1000000000n,
      tdsYtdMinor: 50000000n,
      taxRegime: "new",
      fyStartYear: 2024,
    });

    const result = computeFnfSettlement(input);

    // Gratuity: exempt + taxable = gross
    expect(result.gratuityExemption.exemptMinor + result.gratuityExemption.taxableMinor)
      .toBe(input.gratuityGrossMinor);

    // Leave encashment: exempt + taxable = gross
    expect(result.leaveEncashExemption.exemptMinor + result.leaveEncashExemption.taxableMinor)
      .toBe(input.leaveEncashmentGrossMinor);

    // Retrenchment: null for retirement (non-retrenchment separation)
    expect(result.retrenchmentExemption).toBeNull();

    // VRS: null for retirement (non-VRS separation)
    expect(result.vrsExemption).toBeNull();

    // Overall conservation: totalExempt + totalTaxableOnSeparation = totalGross
    // totalTaxableOnSeparation includes noticeBuyout + arrears + taxable portions of each component
    // totalExempt includes exempt portions of each component
    // So: totalExempt + totalTaxable = totalGross
    expect(result.totalExemptMinor + result.totalTaxableOnSeparationMinor)
      .toBe(result.totalGrossMinor);
  });

  it("conservation holds with retrenchment separation", () => {
    const input = baseFnfInput({
      employeeCategory: "non_govt_covered",
      separationType: "retrenchment",
      completedYears: 10,
      gratuityGrossMinor: 500000000n,    // ₹5L
      lastDrawnWagesMinor: 8000000n,     // ₹80K
      leaveEncashmentGrossMinor: 300000000n, // ₹3L
      avgSalaryLast10MonthsMinor: 8000000n,
      leaveBalanceDays: 120,
      retrenchmentCompMinor: 400000000n, // ₹4L
      noticeBuyoutMinor: 0n,
      arrearsMinor: 0n,
      salaryYtdMinor: 600000000n,
      tdsYtdMinor: 20000000n,
      taxRegime: "new",
      fyStartYear: 2024,
    });

    const result = computeFnfSettlement(input);

    // Gratuity: exempt + taxable = gross
    expect(result.gratuityExemption.exemptMinor + result.gratuityExemption.taxableMinor)
      .toBe(input.gratuityGrossMinor);

    // Leave encashment: retrenchment is NOT in the exempt-qualifying set
    // So fully taxable
    expect(result.leaveEncashExemption.exemptMinor + result.leaveEncashExemption.taxableMinor)
      .toBe(input.leaveEncashmentGrossMinor);

    // Retrenchment compensation: exempt + taxable = gross
    expect(result.retrenchmentExemption).not.toBeNull();
    expect(result.retrenchmentExemption!.exemptMinor + result.retrenchmentExemption!.taxableMinor)
      .toBe(input.retrenchmentCompMinor);

    // Overall conservation: totalExempt + totalTaxable = totalGross
    expect(result.totalExemptMinor + result.totalTaxableOnSeparationMinor)
      .toBe(result.totalGrossMinor);
  });

  it("conservation holds with VRS separation", () => {
    const input = baseFnfInput({
      employeeCategory: "non_govt_covered",
      separationType: "vrs",
      completedYears: 12,
      gratuityGrossMinor: 600000000n,  // ₹6L
      lastDrawnWagesMinor: 9000000n,   // ₹90K
      leaveEncashmentGrossMinor: 200000000n, // ₹2L
      avgSalaryLast10MonthsMinor: 9000000n,
      leaveBalanceDays: 90,
      vrsCompMinor: 800000000n,        // ₹8L
      remainingMonthsToRetirement: 48,
      noticeBuyoutMinor: 0n,
      arrearsMinor: 50000000n,         // ₹50K
      salaryYtdMinor: 900000000n,
      tdsYtdMinor: 30000000n,
      taxRegime: "new",
      fyStartYear: 2024,
    });

    const result = computeFnfSettlement(input);

    // Gratuity: exempt + taxable = gross
    expect(result.gratuityExemption.exemptMinor + result.gratuityExemption.taxableMinor)
      .toBe(input.gratuityGrossMinor);

    // Leave encashment: VRS is NOT in the qualifying separation set
    expect(result.leaveEncashExemption.exemptMinor + result.leaveEncashExemption.taxableMinor)
      .toBe(input.leaveEncashmentGrossMinor);

    // VRS: exempt + taxable = gross
    expect(result.vrsExemption).not.toBeNull();
    expect(result.vrsExemption!.exemptMinor + result.vrsExemption!.taxableMinor)
      .toBe(input.vrsCompMinor);

    // Overall conservation
    expect(result.totalExemptMinor + result.totalTaxableOnSeparationMinor)
      .toBe(result.totalGrossMinor);
  });
});
