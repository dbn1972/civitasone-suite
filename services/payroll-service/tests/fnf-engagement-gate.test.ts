/**
 * F&F engagement terminal-benefit gates (DIC Phase 2) — pure domain tests.
 * A type whose policy excludes gratuity / leave-encashment settles zero for that
 * head; omitting the flags preserves pre-engagement behaviour.
 */
import { describe, it, expect } from "vitest";
import { computeFnfSettlement, type FnfInput } from "../src/modules/fnf/domain.js";

function baseFnfInput(overrides: Partial<FnfInput> = {}): FnfInput {
  return {
    employeeId: "emp-001",
    tenantId: "tenant-001",
    separationType: "resignation",
    separationDate: "2025-01-31",
    employeeCategory: "non_govt_covered",
    noticeBuyoutMinor: 0n,
    leaveEncashmentGrossMinor: 0n,
    gratuityGrossMinor: 0n,
    retrenchmentCompMinor: 0n,
    vrsCompMinor: 0n,
    arrearsMinor: 0n,
    lastDrawnWagesMinor: 5000000n,
    completedYears: 6,
    avgSalaryLast10MonthsMinor: 5000000n,
    leaveBalanceDays: 30,
    priorLeaveEncashExemptionMinor: 0n,
    remainingMonthsToRetirement: 0,
    taxRegime: "new",
    salaryYtdMinor: 0n,
    tdsYtdMinor: 0n,
    deductions80cMinor: 0n,
    deductions80dMinor: 0n,
    otherDeductionsMinor: 0n,
    fyStartYear: 2024,
    gratuityCeilingMinor: 2000000000n,
    leaveEncashCeilingMinor: 2500000000n,
    retrenchmentCeilingMinor: 500000000n,
    vrsCeilingMinor: 500000000n,
    ...overrides,
  };
}

const G = 3000000n; // ₹30,000 gratuity gross
const L = 2000000n; // ₹20,000 leave-encashment gross

describe("F&F engagement terminal-benefit gates", () => {
  it("baseline (eligible by default) settles both heads", () => {
    const r = computeFnfSettlement(baseFnfInput({ gratuityGrossMinor: G, leaveEncashmentGrossMinor: L }));
    expect(r.totalGrossMinor).toBe(G + L);
  });

  it("eligibleForGratuity=false zeros gratuity (consultant/third-party/apprentice)", () => {
    const r = computeFnfSettlement(baseFnfInput({ gratuityGrossMinor: G, leaveEncashmentGrossMinor: L, eligibleForGratuity: false }));
    expect(r.totalGrossMinor).toBe(L);
    expect(r.gratuityExemption.exemptMinor).toBe(0n);
    expect(r.gratuityExemption.taxableMinor).toBe(0n);
  });

  it("leaveEncashmentEligible=false zeros leave-encashment", () => {
    const r = computeFnfSettlement(baseFnfInput({ gratuityGrossMinor: G, leaveEncashmentGrossMinor: L, leaveEncashmentEligible: false }));
    expect(r.totalGrossMinor).toBe(G);
    expect(r.leaveEncashExemption.exemptMinor).toBe(0n);
  });

  it("both excluded → both heads zeroed", () => {
    const r = computeFnfSettlement(baseFnfInput({ gratuityGrossMinor: G, leaveEncashmentGrossMinor: L, eligibleForGratuity: false, leaveEncashmentEligible: false }));
    expect(r.totalGrossMinor).toBe(0n);
  });

  it("omitting the flags preserves pre-engagement behaviour", () => {
    const a = computeFnfSettlement(baseFnfInput({ gratuityGrossMinor: G, leaveEncashmentGrossMinor: L }));
    const b = computeFnfSettlement(baseFnfInput({ gratuityGrossMinor: G, leaveEncashmentGrossMinor: L, eligibleForGratuity: true, leaveEncashmentEligible: true }));
    expect(a.totalGrossMinor).toBe(b.totalGrossMinor);
    expect(a.netPayableMinor).toBe(b.netPayableMinor);
  });
});
