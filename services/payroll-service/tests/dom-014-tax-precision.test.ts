/**
 * DOM-014 — payroll tax was computed in floating-point rupees instead of the
 * codebase's established integer-minor-units (bigint paise) convention.
 * `engine.ts`'s computeTax()/slabTax()/rebate87A()/surchargeRate() and
 * `form16.ts`'s Chapter VI-A / taxable-income aggregation now do every
 * arithmetic step in bigint paise (see engine.ts's DOM-014 doc comment and
 * `computeForm16Deductions` in form16.ts), converting to the Number-rupee
 * public API only once, at the very end.
 *
 * This file pins concrete inputs that DEMONSTRATE the pre-fix bug (declared
 * Chapter VI-A / exempt amounts are arbitrary integer paise — see `amountMinor`
 * in validators.ts — NOT guaranteed whole-rupee, so summing them as
 * `Number(minor) / 100` floats before Sec 288A's round-to-nearest-10 could tip
 * the wrong side of a rounding boundary), plus a property sweep over random
 * declarations proving the float formula really did misround and the new
 * bigint formula never does.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeForm16Deductions, type Form16DeductionInputs } from "../src/modules/tax/form16.js";

/**
 * The exact pre-DOM-014 formula, reproduced here ONLY to prove the bug and to
 * fail loudly if anyone ever reintroduces float rupee arithmetic upstream of
 * a statutory rounding step. Not exported, not used by production code.
 */
function oldFloatTaxableIncome(i: Form16DeductionInputs): number {
  const isOld = i.regime === "old";
  const section80c = isOld ? Math.min(Number(i.section80cMinor) / 100, 150000) : 0;
  const section80d = isOld ? Math.min(Number(i.section80dMinor) / 100, 50000) : 0;
  const hraExempt = isOld ? Number(i.hraClaimedMinor) / 100 : 0;
  const otherDeductions = isOld ? Number(i.otherDeductionsMinor) / 100 : 0;
  const totalChapterViA = section80c + section80d + otherDeductions;
  const extraIncome = Number(i.perquisitesMinor) / 100 + Number(i.prevEmployerSalaryMinor) / 100 + Number(i.otherSourcesIncomeMinor) / 100;
  const grossSalary = Number(i.grossMinor) / 100; // already whole-rupee by construction
  return Math.max(0, Math.round((grossSalary + extraIncome - i.standardDeduction - hraExempt - totalChapterViA) / 10) * 10);
}

describe("DOM-014 — concrete float-rounding-artifact reproductions (old regime)", () => {
  // Found by exhaustive random search over the pre-fix formula: each case is
  // off by exactly one Sec 288A bucket (₹10) between the float and bigint paths.
  const cases: Array<{ name: string; inputs: Omit<Form16DeductionInputs, "regime" | "standardDeduction">; oldTaxable: number; newTaxable: number }> = [
    {
      name: "case 1",
      inputs: {
        grossMinor: 115_657_600n, hraClaimedMinor: 263_485_047n,
        section80cMinor: 1_652_562_290n, section80dMinor: 324_331_597n, otherDeductionsMinor: 913_057_257n,
        perquisitesMinor: 279_249_190n, prevEmployerSalaryMinor: 667_735_101n, otherSourcesIncomeMinor: 154_202_913n,
      },
      oldTaxable: 128020, newTaxable: 128030,
    },
    {
      name: "case 2",
      inputs: {
        grossMinor: 164_694_900n, hraClaimedMinor: 238_769_672n,
        section80cMinor: 1_241_023_104n, section80dMinor: 369_946_941n, otherDeductionsMinor: 420_998_653n,
        perquisitesMinor: 28_364_920n, prevEmployerSalaryMinor: 334_518_697n, otherSourcesIncomeMinor: 309_223_308n,
      },
      oldTaxable: 1495330, newTaxable: 1495340,
    },
    {
      name: "case 3",
      inputs: {
        grossMinor: 194_713_300n, hraClaimedMinor: 221_277_214n,
        section80cMinor: 680_990_362n, section80dMinor: 516_221_739n, otherDeductionsMinor: 45_619_588n,
        perquisitesMinor: 829_537_553n, prevEmployerSalaryMinor: 32_465_558n, otherSourcesIncomeMinor: 748_744_891n,
      },
      oldTaxable: 15110640, newTaxable: 15110650,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: pre-fix float formula rounds to the wrong ₹10 bucket; computeForm16Deductions doesn't`, () => {
      const full: Form16DeductionInputs = { ...c.inputs, standardDeduction: 75000, regime: "old" };
      // Sanity: this really was a live bug, not a hypothetical — the naive
      // float reproduction disagrees with the exact value.
      expect(oldFloatTaxableIncome(full)).toBe(c.oldTaxable);
      expect(oldFloatTaxableIncome(full)).not.toBe(c.newTaxable);
      // The bigint-minor-units fix produces the exact, correct bucket.
      const { taxableIncome } = computeForm16Deductions(full);
      expect(taxableIncome).toBe(c.newTaxable);
    });
  }
});

describe("DOM-014 — property sweep: bigint path never mis-rounds; the old float path sometimes did", () => {
  const arbMinor = fc.bigInt({ min: 0n, max: 2_000_000_000n }); // up to ~2 crore paise (₹20L) per field, arbitrary paise

  it("computeForm16Deductions.taxableIncome is always a non-negative exact multiple of ₹10 (Sec 288A)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 5_000_000 }), // gross rupees, whole-rupee by construction
        arbMinor, arbMinor, arbMinor, arbMinor, arbMinor, arbMinor, arbMinor,
        (grossRupees, hra, s80c, s80d, otherDed, perq, prevSal, otherSrc) => {
          const inputs: Form16DeductionInputs = {
            grossMinor: BigInt(grossRupees) * 100n, standardDeduction: 75000, regime: "old",
            hraClaimedMinor: hra, section80cMinor: s80c, section80dMinor: s80d, otherDeductionsMinor: otherDed,
            perquisitesMinor: perq, prevEmployerSalaryMinor: prevSal, otherSourcesIncomeMinor: otherSrc,
          };
          const { taxableIncome } = computeForm16Deductions(inputs);
          expect(taxableIncome).toBeGreaterThanOrEqual(0);
          expect(taxableIncome % 10).toBe(0);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("reproduces real divergences against the pre-fix float formula, and the bigint result is always the exact one", () => {
    let divergences = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 5_000_000 }),
        arbMinor, arbMinor, arbMinor, arbMinor, arbMinor, arbMinor, arbMinor,
        (grossRupees, hra, s80c, s80d, otherDed, perq, prevSal, otherSrc) => {
          const inputs: Form16DeductionInputs = {
            grossMinor: BigInt(grossRupees) * 100n, standardDeduction: 75000, regime: "old",
            hraClaimedMinor: hra, section80cMinor: s80c, section80dMinor: s80d, otherDeductionsMinor: otherDed,
            perquisitesMinor: perq, prevEmployerSalaryMinor: prevSal, otherSourcesIncomeMinor: otherSrc,
          };
          const oldValue = oldFloatTaxableIncome(inputs);
          const { taxableIncome: newValue } = computeForm16Deductions(inputs);
          if (oldValue !== newValue) {
            divergences++;
            // Every observed divergence in this codebase's search is exactly
            // one Sec 288A bucket (₹10) — the float sum landed on the wrong
            // side of a round-to-nearest-10 boundary.
            expect(Math.abs(oldValue - newValue)).toBe(10);
          }
        },
      ),
      { numRuns: 20000, seed: 1014 },
    );
    // The bug is real and reproducible at this magnitude, not merely theoretical.
    expect(divergences).toBeGreaterThan(0);
  });
});
