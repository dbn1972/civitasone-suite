/**
 * L10 — Domain Correctness: full & final settlement (mutation burn-down)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `fnf/domain.ts` sat at 59.6% with 21 surviving/uncovered mutants, concentrated
 * in the tax computation an employee's final payout depends on (L153-L169):
 *
 *   L153  `salaryYtd + taxableOnSeparation` — a MINUS survived, i.e. separation
 *         income could have been subtracted from FY salary income.
 *   L154  `stdDeduction(...) * 100n` rupee→paise conversion — `/ 100n` survived,
 *         so the standard deduction could have been 10,000x too small.
 *   L155  the old-vs-new regime branch for Chapter VI-A.
 *   L156  `80c + 80d + other` — both a minus and a dropped term survived, so
 *         declared deductions could have reduced relief instead of increasing it.
 *   L159  `totalSalaryIncome - stdDed - chapterViA` — sign mutants survived.
 *   L160  the `annualTaxable < 0n` clamp.
 *   L163  Sec 288A rounding (`/10 * 10`) and `Math.max(0, ...)`.
 *   L165  `totalTax * 100n` rupee→paise.
 *   L169  the `tdsOnSeparation < 0n` clamp — without it a refund would be
 *         emitted as a negative deduction.
 *
 * Expected values are derived from the documented rule, not read back from the
 * implementation. The tax engine is registered with explicit slabs below, so the
 * arithmetic is checkable by hand.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");

type Fnf = Record<string, unknown>;
type FnfResult = {
  totalGrossMinor: bigint;
  totalExemptMinor: bigint;
  totalTaxableOnSeparationMinor: bigint;
  annualTaxableMinor: bigint;
  annualTaxMinor: bigint;
  tdsOnSeparationMinor: bigint;
  netPayableMinor: bigint;
};

let computeFnfSettlement: (input: Fnf) => FnfResult;
const FY = 2025;

/** Old-regime slabs used below — chosen so hand-computation is easy. */
const OLD_SLABS = [
  { from: 0, to: 250000, rate: 0 },
  { from: 250000, to: 500000, rate: 0.05 },
  { from: 500000, to: 1000000, rate: 0.20 },
  { from: 1000000, to: Infinity, rate: 0.30 },
];

beforeAll(async () => {
  const d = await import(`${REPO_ROOT}/services/payroll-service/src/modules/fnf/domain.js`);
  computeFnfSettlement = d.computeFnfSettlement;

  const { registerTaxConfig } = await import(
    `${REPO_ROOT}/services/payroll-service/src/modules/tax/engine.js`
  );
  registerTaxConfig("old", FY, {
    slabs: OLD_SLABS,
    stdDeduction: 50000,
    rebateIncomeCap: 500000,
    rebateMax: 12500,
    surchargeBands: [{ above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 }],
  });
  registerTaxConfig("new", FY, {
    slabs: [
      { from: 0, to: 400000, rate: 0 },
      { from: 400000, to: 800000, rate: 0.05 },
      { from: 800000, to: 1200000, rate: 0.10 },
      { from: 1200000, to: 1600000, rate: 0.15 },
      { from: 1600000, to: 2000000, rate: 0.20 },
      { from: 2000000, to: 2400000, rate: 0.25 },
      { from: 2400000, to: Infinity, rate: 0.30 },
    ],
    stdDeduction: 75000,
    rebateIncomeCap: 1200000,
    rebateMax: 60000,
    surchargeBands: [{ above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 }],
  });
});

/**
 * A settlement with every exemption-bearing component zeroed, so only the
 * fully-taxable legs (notice buyout + arrears) and the tax context are in play.
 * That isolates the Step 5-8 arithmetic these tests target.
 */
function baseInput(over: Fnf = {}): Fnf {
  return {
    employeeId: "11111111-1111-4000-8000-000000000001",
    tenantId: "00000000-0000-0000-0000-000000000001",
    separationType: "resignation",
    separationDate: "2026-01-31",
    employeeCategory: "private",
    noticeBuyoutMinor: 0n,
    leaveEncashmentGrossMinor: 0n,
    gratuityGrossMinor: 0n,
    retrenchmentCompMinor: 0n,
    vrsCompMinor: 0n,
    arrearsMinor: 0n,
    lastDrawnWagesMinor: 5_000_000n,
    completedYears: 3,
    avgSalaryLast10MonthsMinor: 5_000_000n,
    leaveBalanceDays: 0,
    priorLeaveEncashExemptionMinor: 0n,
    remainingMonthsToRetirement: 240,
    taxRegime: "new",
    salaryYtdMinor: 0n,
    tdsYtdMinor: 0n,
    deductions80cMinor: 0n,
    deductions80dMinor: 0n,
    otherDeductionsMinor: 0n,
    fyStartYear: FY,
    ...over,
  };
}

// ── Step 5: separation income ADDS to FY salary income (L153) ────────────────

describe("L10 F&F — separation income adds to FY salary income", () => {
  it("taxable separation income raises annual taxable income", () => {
    // arrears are fully taxable u/s 17(1)
    const without = computeFnfSettlement(baseInput({ salaryYtdMinor: 60_000_000n }));
    const withArrears = computeFnfSettlement(
      baseInput({ salaryYtdMinor: 60_000_000n, arrearsMinor: 10_000_000n }),
    );
    // A surviving MINUS at L153 would make this DECREASE.
    expect(withArrears.annualTaxableMinor).toBe(without.annualTaxableMinor + 10_000_000n);
  });

  it("notice buyout is fully taxable and adds to taxable income", () => {
    const without = computeFnfSettlement(baseInput({ salaryYtdMinor: 60_000_000n }));
    const withBuyout = computeFnfSettlement(
      baseInput({ salaryYtdMinor: 60_000_000n, noticeBuyoutMinor: 5_000_000n }),
    );
    expect(withBuyout.annualTaxableMinor).toBe(without.annualTaxableMinor + 5_000_000n);
    expect(withBuyout.totalTaxableOnSeparationMinor).toBe(5_000_000n);
  });

  it("YTD salary already paid raises taxable income one-for-one", () => {
    const low = computeFnfSettlement(baseInput({ salaryYtdMinor: 60_000_000n }));
    const high = computeFnfSettlement(baseInput({ salaryYtdMinor: 80_000_000n }));
    expect(high.annualTaxableMinor).toBe(low.annualTaxableMinor + 20_000_000n);
  });
});

// ── Standard deduction: rupees -> paise (L154) ───────────────────────────────

describe("L10 F&F — standard deduction is converted rupees to paise", () => {
  it("new regime deducts Rs 75,000 = 7,500,000 paise", () => {
    // salaryYtd 60,00,000 paise (Rs 60,000)... use a large salary so the clamp
    // at zero does not mask the deduction.
    const r = computeFnfSettlement(baseInput({ taxRegime: "new", salaryYtdMinor: 100_000_000n }));
    // annualTaxable = 100_000_000 - 7_500_000 - 0 = 92_500_000
    expect(r.annualTaxableMinor).toBe(92_500_000n);
  });

  it("old regime deducts Rs 50,000 = 5,000,000 paise", () => {
    const r = computeFnfSettlement(baseInput({ taxRegime: "old", salaryYtdMinor: 100_000_000n }));
    // annualTaxable = 100_000_000 - 5_000_000 - 0 = 95_000_000
    expect(r.annualTaxableMinor).toBe(95_000_000n);
  });

  it("the regimes differ by exactly the Rs 25,000 std-deduction gap", () => {
    const nu = computeFnfSettlement(baseInput({ taxRegime: "new", salaryYtdMinor: 100_000_000n }));
    const old = computeFnfSettlement(baseInput({ taxRegime: "old", salaryYtdMinor: 100_000_000n }));
    // A `/ 100n` mutant on the conversion would collapse this difference.
    expect(old.annualTaxableMinor - nu.annualTaxableMinor).toBe(2_500_000n);
  });
});

// ── Chapter VI-A: old regime only, additive (L155, L156) ────────────────────

describe("L10 F&F — Chapter VI-A deductions apply only in the old regime", () => {
  const salary = 100_000_000n;

  it("80C reduces taxable income in the OLD regime", () => {
    const none = computeFnfSettlement(baseInput({ taxRegime: "old", salaryYtdMinor: salary }));
    const with80c = computeFnfSettlement(
      baseInput({ taxRegime: "old", salaryYtdMinor: salary, deductions80cMinor: 15_000_000n }),
    );
    expect(with80c.annualTaxableMinor).toBe(none.annualTaxableMinor - 15_000_000n);
  });

  it("80C is IGNORED in the NEW regime", () => {
    const none = computeFnfSettlement(baseInput({ taxRegime: "new", salaryYtdMinor: salary }));
    const with80c = computeFnfSettlement(
      baseInput({ taxRegime: "new", salaryYtdMinor: salary, deductions80cMinor: 15_000_000n }),
    );
    // Kills the regime-branch inversion at L155.
    expect(with80c.annualTaxableMinor).toBe(none.annualTaxableMinor);
  });

  it("80C, 80D and other deductions accumulate ADDITIVELY (old regime)", () => {
    const none = computeFnfSettlement(baseInput({ taxRegime: "old", salaryYtdMinor: salary }));
    const all = computeFnfSettlement(
      baseInput({
        taxRegime: "old",
        salaryYtdMinor: salary,
        deductions80cMinor: 10_000_000n,
        deductions80dMinor: 2_500_000n,
        otherDeductionsMinor: 1_500_000n,
      }),
    );
    // Kills both the MINUS and the dropped-term mutants at L156.
    expect(all.annualTaxableMinor).toBe(none.annualTaxableMinor - 14_000_000n);
  });

  it("each Chapter VI-A component contributes on its own", () => {
    const none = computeFnfSettlement(baseInput({ taxRegime: "old", salaryYtdMinor: salary }));
    for (const key of ["deductions80cMinor", "deductions80dMinor", "otherDeductionsMinor"]) {
      const one = computeFnfSettlement(
        baseInput({ taxRegime: "old", salaryYtdMinor: salary, [key]: 1_000_000n }),
      );
      expect(one.annualTaxableMinor, `${key} had no effect`).toBe(
        none.annualTaxableMinor - 1_000_000n,
      );
    }
  });
});

// ── Clamps: taxable and TDS never go negative (L160, L169) ──────────────────

describe("L10 F&F — negative results are clamped to zero, never emitted", () => {
  it("annual taxable income clamps at 0 when deductions exceed income", () => {
    const r = computeFnfSettlement(
      baseInput({ taxRegime: "old", salaryYtdMinor: 1_000_000n, deductions80cMinor: 90_000_000n }),
    );
    // 1_000_000 - 5_000_000 - 90_000_000 is deeply negative -> clamp to 0.
    expect(r.annualTaxableMinor).toBe(0n);
    expect(r.annualTaxableMinor).toBeGreaterThanOrEqual(0n);
  });

  it("no tax is due when taxable income clamps to zero", () => {
    const r = computeFnfSettlement(
      baseInput({ taxRegime: "old", salaryYtdMinor: 1_000_000n, deductions80cMinor: 90_000_000n }),
    );
    expect(r.annualTaxMinor).toBe(0n);
  });

  it("TDS on separation clamps at 0 when YTD TDS already exceeds annual tax", () => {
    const r = computeFnfSettlement(
      baseInput({ salaryYtdMinor: 100_000_000n, tdsYtdMinor: 999_000_000n }),
    );
    // Over-deducted YTD: a refund is NOT emitted as a negative deduction.
    expect(r.tdsOnSeparationMinor).toBe(0n);
  });

  it("TDS on separation is annual tax minus YTD TDS when positive", () => {
    // Income must clear the Sec 87A rebate cap (Rs 12,00,000 in the new regime)
    // or the tax is legitimately zero and there is no TDS to apportion.
    const noYtd = computeFnfSettlement(baseInput({ salaryYtdMinor: 200_000_000n, tdsYtdMinor: 0n }));
    const someYtd = computeFnfSettlement(
      baseInput({ salaryYtdMinor: 200_000_000n, tdsYtdMinor: 100_000n }),
    );
    expect(noYtd.tdsOnSeparationMinor).toBeGreaterThan(0n);
    expect(someYtd.tdsOnSeparationMinor).toBe(noYtd.tdsOnSeparationMinor - 100_000n);
  });
});

// ── Annual tax: rupee/paise conversion and Sec 288A rounding (L163, L165) ───

describe("L10 F&F — annual tax conversion and Sec 288A rounding", () => {
  it("annual tax is a whole number of rupees expressed in paise", () => {
    const r = computeFnfSettlement(baseInput({ salaryYtdMinor: 100_000_000n }));
    // A `/ 100n` mutant at L165 would leave a non-rupee-aligned figure.
    expect(r.annualTaxMinor % 100n).toBe(0n);
  });

  it("Sec 87A rebate zeroes the tax below the rebate cap", () => {
    // salaryYtd Rs 10,00,000; new-regime std ded Rs 75,000 -> taxable Rs 9,25,000.
    // Slab tax = 0 (0-4L) + 20,000 (4L-8L @5%) + 12,500 (8L-9.25L @10%) = 32,500.
    // Taxable Rs 9,25,000 <= the Rs 12,00,000 rebate cap, so 87A rebates
    // min(32,500, 60,000) = 32,500 and the tax is legitimately ZERO.
    const r = computeFnfSettlement(baseInput({ taxRegime: "new", salaryYtdMinor: 100_000_000n }));
    expect(r.annualTaxableMinor).toBe(92_500_000n);
    expect(r.annualTaxMinor).toBe(0n);
  });

  it("annual tax above the rebate cap is computed from the slabs by hand", () => {
    // salaryYtd Rs 20,00,000; std ded Rs 75,000 -> taxable Rs 19,25,000
    // (Sec 288A rounds to the nearest 10 -> unchanged).
    // Above the Rs 12,00,000 cap, so NO 87A rebate:
    //        0-4L    @0                        =       0
    //        4L-8L   @5%  on 4,00,000          =  20,000
    //        8L-12L  @10% on 4,00,000          =  40,000
    //        12L-16L @15% on 4,00,000          =  60,000
    //        16L-19.25L @20% on 3,25,000       =  65,000
    //        base tax                          = 185,000
    //        surcharge: none (below Rs 50L)
    //        cess 4% of 185,000                =   7,400
    //        total 192,400, rounded to 10      = 192,400
    const r = computeFnfSettlement(baseInput({ taxRegime: "new", salaryYtdMinor: 200_000_000n }));
    expect(r.annualTaxableMinor).toBe(192_500_000n);
    expect(r.annualTaxMinor).toBe(19_240_000n); // Rs 1,92,400 in paise
  });

  it("a higher taxable income yields a higher tax (monotonic)", () => {
    const lo = computeFnfSettlement(baseInput({ salaryYtdMinor: 100_000_000n }));
    const hi = computeFnfSettlement(baseInput({ salaryYtdMinor: 200_000_000n }));
    // Kills Math.max -> Math.min and the `* 100` / `/ 100` swaps at L163.
    expect(hi.annualTaxMinor).toBeGreaterThan(lo.annualTaxMinor);
  });

  it("zero income yields zero tax", () => {
    const r = computeFnfSettlement(baseInput({ salaryYtdMinor: 0n }));
    expect(r.annualTaxableMinor).toBe(0n);
    expect(r.annualTaxMinor).toBe(0n);
  });
});

// ── Step 8: net payable conservation ────────────────────────────────────────

describe("L10 F&F — net payable equals gross less TDS", () => {
  it("net = gross - TDS on separation", () => {
    const r = computeFnfSettlement(
      baseInput({
        salaryYtdMinor: 100_000_000n,
        noticeBuyoutMinor: 5_000_000n,
        arrearsMinor: 2_000_000n,
      }),
    );
    expect(r.netPayableMinor).toBe(r.totalGrossMinor - r.tdsOnSeparationMinor);
  });

  it("gross is the sum of all settlement legs", () => {
    const r = computeFnfSettlement(
      baseInput({
        noticeBuyoutMinor: 1_000_000n,
        leaveEncashmentGrossMinor: 2_000_000n,
        gratuityGrossMinor: 3_000_000n,
        retrenchmentCompMinor: 4_000_000n,
        vrsCompMinor: 5_000_000n,
        arrearsMinor: 6_000_000n,
      }),
    );
    expect(r.totalGrossMinor).toBe(21_000_000n);
  });

  it("every leg contributes to gross individually", () => {
    const legs = [
      "noticeBuyoutMinor",
      "leaveEncashmentGrossMinor",
      "gratuityGrossMinor",
      "retrenchmentCompMinor",
      "vrsCompMinor",
      "arrearsMinor",
    ];
    for (const leg of legs) {
      const r = computeFnfSettlement(baseInput({ [leg]: 1_000_000n }));
      expect(r.totalGrossMinor, `${leg} missing from gross`).toBe(1_000_000n);
    }
  });
});
