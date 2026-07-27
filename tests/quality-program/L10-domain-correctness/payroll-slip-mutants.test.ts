/**
 * L10 — Domain Correctness: payroll slip assembly (mutation burn-down)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * After the mutation-runner scope was fixed, `payroll/domain.ts` scored 37.4%
 * with 176 surviving + 93 no-coverage mutants — 269 places the salary engine can
 * be altered with no test failing. `scripts/ci/mutation-survivors.mjs` grouped
 * them; these are the semantically dangerous ones, not label strings:
 *
 *   L202-203  ESI cap boundary (`gross <= ESI_CAP`) and both ESI rates.
 *             `grossMinor * 75n * 10000n` and `/ 325n` both survived — the rate
 *             arithmetic was entirely unasserted.
 *   L206      `pt > 0n` guard — a zero PT line being emitted went unnoticed.
 *   L210      `grossMinor * 12n` annualisation; `/ 12n` survived.
 *   L218      `perq + prevEmpSal + otherSrc` — a MINUS survived, i.e. declared
 *             extra income could be subtracted from taxable pay and no test knew.
 *   L220-224  The whole OLD-REGIME branch was NoCoverage: HRA exemption, 80C/80D
 *             caps, PT deduction.
 *   L158-170  Zero-valued components must be OMITTED from the slip; the guards
 *             `daMinor > 0n`, `hraMinor > 0n`, `amt === 0n` were unasserted.
 *
 * Every expected value below is computed BY HAND from the statutory rule and the
 * documented constants, not read back from the implementation:
 *   roundRupee(x) = floor((x + 50) / 100) * 100      (round-half-up to rupee)
 *   pct(base, p)  = roundRupee(base * p / 100)
 *   PF 12% of (basic+DA) capped at wage ceiling 1_500_000 paise (Rs 15,000)
 *   ESI employee 0.75%, employer 3.25%, only while gross <= 2_100_000 (Rs 21,000)
 *   HRA slab % of basic by city class and DA tier (DA>=100% / >=50% / below):
 *     X 30/27/24   Y 20/18/16   Z 10/9/8
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const REPO_ROOT = resolve(__dirname, "../../..");

type Component = { code: string; name: string; type: "earning" | "deduction"; amountMinor: bigint };
type SlipResult = {
  grossMinor: bigint;
  totalDeductionsMinor: bigint;
  netPayMinor: bigint;
  daMinor: bigint;
  hraMinor: bigint;
  earnings: Component[];
  deductions: Component[];
  pfEmployeeMinor: bigint;
  esiMinor: bigint;
  esiEmployerMinor: bigint;
  ptMinor: bigint;
  tdsMinor: bigint;
  annualTaxableMinor: bigint;
  recoveryCarryForwardMinor: bigint;
  negativeNet: boolean;
};

let computeSlip: (input: Record<string, unknown>) => SlipResult;
let hraSlabPct: (cityClass: string, daRateBps: bigint) => bigint;
let roundRupee: (x: bigint) => bigint;

const FY = 2025;

beforeAll(async () => {
  const domain = await import(`${REPO_ROOT}/services/payroll-service/src/modules/payroll/domain.js`);
  computeSlip = domain.computeSlip;
  hraSlabPct = domain.hraSlabPct;
  roundRupee = domain.roundRupee;

  // The tax engine throws UnconfiguredFyError unless slabs are registered.
  // FY2025-26 new-regime slabs + the old-regime slabs used by the old-regime
  // assertions below.
  const { registerTaxConfig } = await import(
    `${REPO_ROOT}/services/payroll-service/src/modules/tax/engine.js`
  );
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
  registerTaxConfig("old", FY, {
    slabs: [
      { from: 0, to: 250000, rate: 0 },
      { from: 250000, to: 500000, rate: 0.05 },
      { from: 500000, to: 1000000, rate: 0.20 },
      { from: 1000000, to: Infinity, rate: 0.30 },
    ],
    stdDeduction: 50000,
    rebateIncomeCap: 500000,
    rebateMax: 12500,
    surchargeBands: [{ above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 }],
  });
});

const codes = (list: Component[]) => list.map((c) => c.code);
const amountOf = (list: Component[], code: string) =>
  list.find((c) => c.code === code)?.amountMinor;

// ── Zero-valued components must be OMITTED (L158, L162, L170) ────────────────

describe("L10 payroll — zero-valued lines are omitted from the slip", () => {
  it("DA line is absent when the DA rate is 0", () => {
    const r = computeSlip({ basicMinor: 5_000_000n, daRateBps: 0n, cityClass: "Z", taxRegime: "new", fyStartYear: FY });
    expect(r.daMinor).toBe(0n);
    expect(codes(r.earnings)).not.toContain("DA");
  });

  it("DA line is present and exact when the rate is set", () => {
    // basic 50,000.00 = 5_000_000 paise; DA 53% => 5_000_000 * 5300 / 10000
    //   = 2_650_000 paise, already whole rupees => 2_650_000
    const r = computeSlip({ basicMinor: 5_000_000n, daRateBps: 5300n, cityClass: "Z", taxRegime: "new", fyStartYear: FY });
    expect(r.daMinor).toBe(2_650_000n);
    expect(amountOf(r.earnings, "DA")).toBe(2_650_000n);
  });

  it("HRA line is absent when the city slab yields 0 (basic 0)", () => {
    const r = computeSlip({ basicMinor: 0n, daRateBps: 0n, cityClass: "X", taxRegime: "new", fyStartYear: FY });
    expect(r.hraMinor).toBe(0n);
    expect(codes(r.earnings)).not.toContain("HRA");
  });

  it("a raw component computing to 0 is skipped entirely", () => {
    const r = computeSlip({
      basicMinor: 5_000_000n,
      daRateBps: 0n,
      cityClass: "Z",
      taxRegime: "new",
      fyStartYear: FY,
      rawComponents: [
        { code: "ZEROFIX", name: "Zero Fixed", type: "earning", fixedMinor: 0n },
        { code: "REALFIX", name: "Real Fixed", type: "earning", fixedMinor: 100_000n },
      ],
    });
    expect(codes(r.earnings)).not.toContain("ZEROFIX");
    expect(amountOf(r.earnings, "REALFIX")).toBe(100_000n);
  });
});

// ── HRA slab table (L162 + hraSlabPct tiers) ─────────────────────────────────

describe("L10 payroll — HRA slab by city class and DA tier (vs golden fixture)", () => {
  // Driven from goldens/payroll-goldens.json so the fixture cannot silently
  // contradict the implementation again. It previously recorded X=27% at DA<25%
  // with class names A/B/C — both wrong, and unasserted, so it went unnoticed.
  const golden = JSON.parse(
    readFileSync(resolve(__dirname, "../goldens/payroll-goldens.json"), "utf8"),
  ) as { hra_slab: { cases: Array<{ cityClass: string; daRateBps: number; expectedPct: number }> } };

  it("golden fixture is populated (guards against an empty case list)", () => {
    expect(golden.hra_slab.cases.length).toBeGreaterThanOrEqual(9);
  });

  for (const c of golden.hra_slab.cases) {
    it(`${c.cityClass} at DA ${c.daRateBps / 100}% -> ${c.expectedPct}%`, () => {
      expect(hraSlabPct(c.cityClass, BigInt(c.daRateBps))).toBe(BigInt(c.expectedPct));
    });
  }

  it("HRA amount equals slab pct of basic", () => {
    // basic 40,000.00; X class, DA 0 => 24% => 4_000_000 * 24 / 100 = 960_000
    const r = computeSlip({ basicMinor: 4_000_000n, daRateBps: 0n, cityClass: "X", taxRegime: "new", fyStartYear: FY });
    expect(r.hraMinor).toBe(960_000n);
  });
});

// ── ESI cap boundary and both rates (L202, L203) ─────────────────────────────

describe("L10 payroll — ESI applies only at or below the Rs 21,000 gross ceiling", () => {
  /** Build a slip whose gross is exactly `basic` by zeroing DA and HRA (Z class needs basic>0, so use rawComponents-free Z with pct 8% — instead use cityClass Z and subtract). */
  function slipWithGross(basicMinor: bigint) {
    // cityClass Z at DA 0 adds 8% HRA, so gross = basic * 1.08. Choose basic so
    // the arithmetic stays exact and assert against the computed gross.
    return computeSlip({
      basicMinor,
      daRateBps: 0n,
      cityClass: "Z",
      pensionScheme: "EPF",
      taxRegime: "new",
      fyStartYear: FY,
    });
  }

  it("employee ESI is 0.75% of gross when gross <= cap", () => {
    // basic 1,000,000 paise (Rs 10,000) + 8% HRA 80_000 => gross 1_080_000 <= 2_100_000
    const r = slipWithGross(1_000_000n);
    expect(r.grossMinor).toBe(1_080_000n);
    // 1_080_000 * 75 / 10000 = 8_100 -> roundRupee(8_100) = 8_100
    expect(r.esiMinor).toBe(roundRupee((1_080_000n * 75n) / 10000n));
    expect(r.esiMinor).toBe(8_100n);
  });

  it("employer ESI is 3.25% of gross when gross <= cap", () => {
    const r = slipWithGross(1_000_000n);
    // 1_080_000 * 325 / 10000 = 35_100
    expect(r.esiEmployerMinor).toBe(35_100n);
  });

  it("ESI is charged at exactly the cap (boundary is inclusive)", () => {
    // Need gross == 2_100_000 exactly. basic * 1.08 = 2_100_000 is not integral,
    // so drive gross with a fixed earning and no HRA (basic 0 => HRA 0).
    const r = computeSlip({
      basicMinor: 0n,
      daRateBps: 0n,
      cityClass: "Z",
      taxRegime: "new",
      fyStartYear: FY,
      rawComponents: [{ code: "SPECIAL", name: "Special", type: "earning", fixedMinor: 2_100_000n }],
    });
    expect(r.grossMinor).toBe(2_100_000n);
    // At the cap ESI still applies: 2_100_000 * 75 / 10000 = 15_750 -> round -> 15_800
    expect(r.esiMinor).toBe(roundRupee((2_100_000n * 75n) / 10000n));
    expect(r.esiMinor).toBeGreaterThan(0n);
  });

  it("ESI is zero one paise above the cap", () => {
    const r = computeSlip({
      basicMinor: 0n,
      daRateBps: 0n,
      cityClass: "Z",
      taxRegime: "new",
      fyStartYear: FY,
      rawComponents: [{ code: "SPECIAL", name: "Special", type: "earning", fixedMinor: 2_100_100n }],
    });
    expect(r.grossMinor).toBe(2_100_100n);
    expect(r.esiMinor).toBe(0n);
    expect(r.esiEmployerMinor).toBe(0n);
  });
});

// ── Professional tax guard (L206) ────────────────────────────────────────────

describe("L10 payroll — professional tax line", () => {
  it("PT line is omitted when ptMinor is 0", () => {
    const r = computeSlip({ basicMinor: 5_000_000n, ptMinor: 0n, cityClass: "Z", taxRegime: "new", fyStartYear: FY });
    expect(r.ptMinor).toBe(0n);
    expect(codes(r.deductions)).not.toContain("PT");
  });

  it("PT line is present and rounded to the rupee when set", () => {
    const r = computeSlip({ basicMinor: 5_000_000n, ptMinor: 20_049n, cityClass: "Z", taxRegime: "new", fyStartYear: FY });
    // roundRupee(20_049) = ((20_049 + 50) / 100) * 100 = 20_000
    expect(r.ptMinor).toBe(20_000n);
    expect(amountOf(r.deductions, "PT")).toBe(20_000n);
  });
});

// ── EPF wage ceiling (L193-195) ──────────────────────────────────────────────

describe("L10 payroll — EPF 12% of (basic+DA) capped at the Rs 15,000 wage ceiling", () => {
  it("below the ceiling, PF is 12% of basic+DA", () => {
    // basic 1_000_000 + DA 0 => pensionBase 1_000_000 <= 1_500_000
    // 12% => 120_000
    const r = computeSlip({ basicMinor: 1_000_000n, daRateBps: 0n, cityClass: "Z", pensionScheme: "EPF", taxRegime: "new", fyStartYear: FY });
    expect(r.pfEmployeeMinor).toBe(120_000n);
  });

  it("above the ceiling, PF is 12% of the ceiling, not of actual pay", () => {
    // basic 5_000_000 + DA 0 => pensionBase 5_000_000 > 1_500_000 => use cap
    // 12% of 1_500_000 = 180_000
    const r = computeSlip({ basicMinor: 5_000_000n, daRateBps: 0n, cityClass: "Z", pensionScheme: "EPF", taxRegime: "new", fyStartYear: FY });
    expect(r.pfEmployeeMinor).toBe(180_000n);
  });

  it("at exactly the ceiling, PF is 12% of the ceiling", () => {
    const r = computeSlip({ basicMinor: 1_500_000n, daRateBps: 0n, cityClass: "Z", pensionScheme: "EPF", taxRegime: "new", fyStartYear: FY });
    expect(r.pfEmployeeMinor).toBe(180_000n);
  });
});

// ── Declared extra income must INCREASE taxable pay (L218) ───────────────────

describe("L10 payroll — declared extra income raises annual taxable income", () => {
  const base = {
    basicMinor: 5_000_000n,
    daRateBps: 0n,
    cityClass: "Z" as const,
    pensionScheme: "EPF" as const,
    taxRegime: "new" as const,
    fyStartYear: FY,
  };

  it("perquisites add to taxable income", () => {
    const without = computeSlip({ ...base });
    const withPerq = computeSlip({ ...base, declaration: { perquisitesMinor: 10_000_000n } });
    // A surviving MINUS mutant here would make this DECREASE.
    expect(withPerq.annualTaxableMinor).toBe(without.annualTaxableMinor + 10_000_000n);
  });

  it("previous-employer salary adds to taxable income (Sec 192(2))", () => {
    const without = computeSlip({ ...base });
    const withPrev = computeSlip({ ...base, declaration: { prevEmployerSalaryMinor: 25_000_000n } });
    expect(withPrev.annualTaxableMinor).toBe(without.annualTaxableMinor + 25_000_000n);
  });

  it("other-sources income adds to taxable income", () => {
    const without = computeSlip({ ...base });
    const withOther = computeSlip({ ...base, declaration: { otherSourcesIncomeMinor: 5_000_000n } });
    expect(withOther.annualTaxableMinor).toBe(without.annualTaxableMinor + 5_000_000n);
  });

  it("all three accumulate additively", () => {
    const without = computeSlip({ ...base });
    const all = computeSlip({
      ...base,
      declaration: {
        perquisitesMinor: 1_000_000n,
        prevEmployerSalaryMinor: 2_000_000n,
        otherSourcesIncomeMinor: 3_000_000n,
      },
    });
    expect(all.annualTaxableMinor).toBe(without.annualTaxableMinor + 6_000_000n);
  });

  it("annual gross is 12x the monthly gross (not a division)", () => {
    // new regime: taxable = gross*12 + extras - stdDeduction(75_000 rupees) - LTC
    const r = computeSlip({ ...base });
    const expected = r.grossMinor * 12n - 7_500_000n;
    expect(r.annualTaxableMinor).toBe(expected > 0n ? expected : 0n);
  });
});

// ── Old regime branch — was entirely NoCoverage (L220-L228) ──────────────────

describe("L10 payroll — old regime deductions (previously uncovered)", () => {
  const base = {
    basicMinor: 5_000_000n,
    daRateBps: 0n,
    cityClass: "X" as const,
    pensionScheme: "EPF" as const,
    taxRegime: "old" as const,
    fyStartYear: FY,
  };

  it("old regime applies a Rs 50,000 standard deduction, new regime Rs 75,000", () => {
    const oldR = computeSlip({ ...base });
    const newR = computeSlip({ ...base, taxRegime: "new" });
    // Same gross; the taxable difference is the std-deduction gap (25,000 rupees
    // = 2_500_000 paise) plus the old regime's PT and HRA-exemption terms, which
    // are zero here (ptMinor 0, no rent declared -> hraExempt 0 because rent 0).
    expect(newR.annualTaxableMinor).toBeLessThan(oldR.annualTaxableMinor);
    expect(oldR.annualTaxableMinor - newR.annualTaxableMinor).toBe(2_500_000n);
  });

  it("80C reduces taxable income and is capped at Rs 1,50,000", () => {
    const none = computeSlip({ ...base });
    const partial = computeSlip({ ...base, declaration: { ded80cMinor: 10_000_000n } });
    const atCap = computeSlip({ ...base, declaration: { ded80cMinor: 15_000_000n } });
    const overCap = computeSlip({ ...base, declaration: { ded80cMinor: 90_000_000n } });

    expect(partial.annualTaxableMinor).toBe(none.annualTaxableMinor - 10_000_000n);
    expect(atCap.annualTaxableMinor).toBe(none.annualTaxableMinor - 15_000_000n);
    // Beyond the cap the extra claim is ignored — same result as at the cap.
    expect(overCap.annualTaxableMinor).toBe(atCap.annualTaxableMinor);
  });

  it("80D reduces taxable income and is capped at Rs 75,000", () => {
    const none = computeSlip({ ...base });
    const atCap = computeSlip({ ...base, declaration: { ded80dMinor: 7_500_000n } });
    const overCap = computeSlip({ ...base, declaration: { ded80dMinor: 50_000_000n } });
    expect(atCap.annualTaxableMinor).toBe(none.annualTaxableMinor - 7_500_000n);
    expect(overCap.annualTaxableMinor).toBe(atCap.annualTaxableMinor);
  });

  it("PT is deductible in the old regime (12 months' worth)", () => {
    const noPt = computeSlip({ ...base, ptMinor: 0n });
    const withPt = computeSlip({ ...base, ptMinor: 20_000n });
    // Old regime subtracts pt * 12. PT also reduces net pay, but annualTaxable
    // must drop by exactly 12 * 20_000 = 240_000.
    expect(withPt.annualTaxableMinor).toBe(noPt.annualTaxableMinor - 240_000n);
  });

  it("Sec 10(13A) HRA exemption is the least of the three statutory limits", () => {
    // basic 50,000/mo, X (metro), DA 0 => HRA received 24% = 12,000/mo
    // annual salary (basic+DA) = 600_000 rupees = 60_000_000 paise
    // annual HRA received = 144_000 rupees = 14_400_000 paise
    // rent 300_000 rupees/yr = 30_000_000 paise
    //   a) HRA received                    = 14_400_000
    //   b) rent - 10% salary = 30_000_000 - 6_000_000 = 24_000_000
    //   c) 50% salary (metro)              = 30_000_000
    //   least = 14_400_000
    const noRent = computeSlip({ ...base });
    const withRent = computeSlip({ ...base, declaration: { rentPaidAnnualMinor: 30_000_000n } });
    expect(noRent.annualTaxableMinor - withRent.annualTaxableMinor).toBe(14_400_000n);
  });

  it("a low rent yields a smaller exemption (limit b binds)", () => {
    // rent 80_000 rupees = 8_000_000 paise; b = 8_000_000 - 6_000_000 = 2_000_000
    // which is now the least of {14_400_000, 2_000_000, 30_000_000}
    const noRent = computeSlip({ ...base });
    const lowRent = computeSlip({ ...base, declaration: { rentPaidAnnualMinor: 8_000_000n } });
    expect(noRent.annualTaxableMinor - lowRent.annualTaxableMinor).toBe(2_000_000n);
  });

  it("rent below 10% of salary yields no exemption (b clamps at 0)", () => {
    const noRent = computeSlip({ ...base });
    const tinyRent = computeSlip({ ...base, declaration: { rentPaidAnnualMinor: 1_000_000n } });
    expect(tinyRent.annualTaxableMinor).toBe(noRent.annualTaxableMinor);
  });
});

// ── Recovery floor: net pay protection (L~250-280) ───────────────────────────

describe("L10 payroll — protected net floor caps recovery and carries the rest", () => {
  const base = {
    basicMinor: 5_000_000n,
    daRateBps: 0n,
    cityClass: "Z" as const,
    pensionScheme: "EPF" as const,
    taxRegime: "new" as const,
    fyStartYear: FY,
  };

  it("recovery within headroom is applied in full with no carry-forward", () => {
    const r = computeSlip({
      ...base,
      components: [{ code: "LOAN_EMI", name: "Loan EMI", type: "deduction", amountMinor: 100_000n }],
      protectedNetFloorMinor: 0n,
    });
    expect(r.recoveryCarryForwardMinor).toBe(0n);
    expect(amountOf(r.deductions, "LOAN_EMI")).toBe(100_000n);
  });

  it("recovery exceeding headroom is trimmed and the remainder carried forward", () => {
    const unfloored = computeSlip({ ...base, protectedNetFloorMinor: 0n });
    // Demand a recovery larger than the entire net pay.
    const demand = unfloored.netPayMinor + 1_000_000n;
    const r = computeSlip({
      ...base,
      components: [{ code: "LOAN_EMI", name: "Loan EMI", type: "deduction", amountMinor: demand }],
      protectedNetFloorMinor: 0n,
    });
    expect(r.recoveryCarryForwardMinor).toBeGreaterThan(0n);
    // Conservation: applied + carried == demanded.
    const applied = amountOf(r.deductions, "LOAN_EMI") ?? 0n;
    expect(applied + r.recoveryCarryForwardMinor).toBe(demand);
  });

  it("net pay never falls below the protected floor", () => {
    const floor = 2_000_000n;
    const r = computeSlip({
      ...base,
      components: [{ code: "LOAN_EMI", name: "Loan EMI", type: "deduction", amountMinor: 10_000_000n }],
      protectedNetFloorMinor: floor,
    });
    expect(r.netPayMinor).toBeGreaterThanOrEqual(floor);
    expect(r.recoveryCarryForwardMinor).toBeGreaterThan(0n);
  });

  it("a fully-trimmed recovery line is dropped from the slip", () => {
    const r = computeSlip({
      ...base,
      components: [{ code: "LOAN_EMI", name: "Loan EMI", type: "deduction", amountMinor: 50_000_000n }],
      // Floor above gross leaves zero headroom, so the whole line is trimmed.
      protectedNetFloorMinor: 100_000_000n,
    });
    expect(codes(r.deductions)).not.toContain("LOAN_EMI");
    expect(r.recoveryCarryForwardMinor).toBe(50_000_000n);
  });

  it("statutory deductions are NOT subject to the floor", () => {
    // With a floor above gross, PF/ESI/TDS still apply, so net can sit below it.
    const r = computeSlip({ ...base, protectedNetFloorMinor: 100_000_000n });
    expect(r.pfEmployeeMinor).toBeGreaterThan(0n);
    expect(r.netPayMinor).toBeLessThan(100_000_000n);
  });
});

// ── Slip arithmetic conservation ─────────────────────────────────────────────

describe("L10 payroll — gross/deduction/net conservation", () => {
  it("gross equals the sum of earning lines", () => {
    const r = computeSlip({
      basicMinor: 5_000_000n,
      daRateBps: 5300n,
      cityClass: "X",
      pensionScheme: "EPF",
      taxRegime: "new",
      fyStartYear: FY,
      rawComponents: [{ code: "CONV", name: "Conveyance", type: "earning", fixedMinor: 160_000n }],
    });
    const sum = r.earnings.reduce((a, e) => a + e.amountMinor, 0n);
    expect(r.grossMinor).toBe(sum);
  });

  it("net equals gross minus total deductions", () => {
    const r = computeSlip({
      basicMinor: 5_000_000n,
      daRateBps: 5300n,
      cityClass: "X",
      ptMinor: 20_000n,
      pensionScheme: "EPF",
      taxRegime: "new",
      fyStartYear: FY,
    });
    expect(r.netPayMinor).toBe(r.grossMinor - r.totalDeductionsMinor);
    expect(r.negativeNet).toBe(false);
  });

  it("raw components route to earnings or deductions by type", () => {
    const r = computeSlip({
      basicMinor: 5_000_000n,
      daRateBps: 0n,
      cityClass: "Z",
      taxRegime: "new",
      fyStartYear: FY,
      rawComponents: [
        { code: "BONUS", name: "Bonus", type: "earning", fixedMinor: 500_000n },
        { code: "SOCIETY", name: "Society Dues", type: "deduction", fixedMinor: 100_000n },
      ],
    });
    expect(codes(r.earnings)).toContain("BONUS");
    expect(codes(r.deductions)).toContain("SOCIETY");
    expect(codes(r.earnings)).not.toContain("SOCIETY");
  });

  it("pctOfBasic takes precedence over fixedMinor when both are present", () => {
    const r = computeSlip({
      basicMinor: 5_000_000n,
      daRateBps: 0n,
      cityClass: "Z",
      taxRegime: "new",
      fyStartYear: FY,
      rawComponents: [
        { code: "SPL", name: "Special", type: "earning", pctOfBasic: 10, fixedMinor: 999_999n },
      ],
    });
    // 10% of 5_000_000 = 500_000, NOT the fixed 999_999.
    expect(amountOf(r.earnings, "SPL")).toBe(500_000n);
  });

  it("fixedMinor is used when pctOfBasic is absent or zero", () => {
    const r = computeSlip({
      basicMinor: 5_000_000n,
      daRateBps: 0n,
      cityClass: "Z",
      taxRegime: "new",
      fyStartYear: FY,
      rawComponents: [
        { code: "A", name: "A", type: "earning", pctOfBasic: 0, fixedMinor: 111_100n },
        { code: "B", name: "B", type: "earning", fixedMinor: 222_200n },
      ],
    });
    expect(amountOf(r.earnings, "A")).toBe(111_100n);
    expect(amountOf(r.earnings, "B")).toBe(222_200n);
  });

  it("BASIC/DA/HRA raw components are ignored (handled ahead of the loop)", () => {
    const r = computeSlip({
      basicMinor: 5_000_000n,
      daRateBps: 0n,
      cityClass: "Z",
      taxRegime: "new",
      fyStartYear: FY,
      rawComponents: [
        { code: "BASIC", name: "Dup Basic", type: "earning", fixedMinor: 9_000_000n },
        { code: "DA", name: "Dup DA", type: "earning", fixedMinor: 9_000_000n },
        { code: "HRA", name: "Dup HRA", type: "earning", fixedMinor: 9_000_000n },
      ],
    });
    // Exactly one BASIC line, and no duplicate inflation of gross.
    expect(codes(r.earnings).filter((c) => c === "BASIC")).toHaveLength(1);
    expect(amountOf(r.earnings, "BASIC")).toBe(5_000_000n);
  });
});

// ── roundRupee half-up behaviour ─────────────────────────────────────────────

describe("L10 payroll — roundRupee is round-half-up and sign-symmetric", () => {
  const cases: Array<[bigint, bigint]> = [
    [0n, 0n],
    [49n, 0n],
    [50n, 100n],
    [51n, 100n],
    [149n, 100n],
    [150n, 200n],
    [100n, 100n],
  ];
  for (const [input, expected] of cases) {
    it(`roundRupee(${input}) = ${expected}`, () => {
      expect(roundRupee(input)).toBe(expected);
    });
  }

  it("negative amounts round symmetrically", () => {
    expect(roundRupee(-50n)).toBe(-100n);
    expect(roundRupee(-49n)).toBe(0n);
  });
});
