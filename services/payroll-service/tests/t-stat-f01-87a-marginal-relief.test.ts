/**
 * T-STAT F01 (HIGH, statutory audit 2026-11-03): the new-regime s.87A rebate
 * had no marginal relief.
 *
 * Law (s.87A read with s.115BAC(1A), as amended by the Finance Act 2025, for
 * FY 2025-26 onward): a resident individual on the new regime whose total
 * income does not exceed Rs 12,00,000 gets a rebate of up to Rs 60,000. Where
 * total income exceeds Rs 12,00,000, the proviso grants marginal relief: the
 * income-tax (before the 4% health and education cess) may not exceed the
 * amount by which total income exceeds Rs 12,00,000. Cess is then charged on
 * the relieved tax. The old regime keeps its Rs 12,500 rebate at
 * Rs 5,00,000 and has no marginal relief.
 *
 * Expected figures are those of the auditor illustrate.py law_tax(), rounded
 * to the nearest Rs 10 under s.288B as the engine does.
 */
import { describe, it, expect } from "vitest";
import { computeTax, annualTaxFromTaxableMinor, registerTaxConfig, getTaxConfig } from "../src/modules/tax/engine.js";

const tax = (taxable: number, regime: "new" | "old" = "new", fy = 2026) => computeTax(taxable, regime, fy).totalTax;

describe("T-STAT F01: s.87A rebate marginal relief (new regime, FY 2026-27)", () => {
  it("Rs 12,00,000 -> 0 (full Rs 60,000 rebate)", () => {
    expect(tax(1200000)).toBe(0);
    expect(computeTax(1200000, "new", 2026).rebate).toBe(60000);
  });

  it("Rs 12,10,000 -> Rs 10,000 + 4% cess = Rs 10,400 (was Rs 63,960)", () => {
    const r = computeTax(1210000, "new", 2026);
    expect(r.baseTax).toBe(61500);
    expect(r.rebate).toBe(51500); // relief = 61,500 - (12,10,000 - 12,00,000)
    expect(r.cess).toBe(400);
    expect(r.totalTax).toBe(10400);
  });

  it("illustrate.py boundary incomes match the law", () => {
    expect(tax(1190616)).toBe(0);
    expect(tax(1204080)).toBe(4240); // L2-021750 after the next 2% DA rise (code charged 63,040)
    expect(tax(1250000)).toBe(52000);
    expect(tax(1280000)).toBe(74880);
  });

  it("Rs 12,70,000 -> relieved tax Rs 70,000 + cess = Rs 72,800", () => {
    const r = computeTax(1270000, "new", 2026);
    expect(r.baseTax).toBe(70500);
    expect(r.rebate).toBe(500);
    expect(r.totalTax).toBe(72800);
  });

  it("crossover at about Rs 12,70,588: relief still applies just below, stops just above", () => {
    // Slab tax 60,000 + 15% x (I - 12L) equals (I - 12L) at I = 12,70,588.
    expect(computeTax(1270580, "new", 2026).rebate).toBeGreaterThan(0);
    expect(tax(1270580)).toBe(73400); // 70,580 x 1.04
    expect(computeTax(1270590, "new", 2026).rebate).toBe(0);
    expect(tax(1270590)).toBe(73410);
  });

  it("Rs 12,75,000 is past the crossover: no relief, Rs 71,250 + cess = Rs 74,100", () => {
    const r = computeTax(1275000, "new", 2026);
    expect(r.rebate).toBe(0);
    expect(r.totalTax).toBe(74100);
  });

  it("Rs 15,00,000 -> Rs 1,05,000 + cess = Rs 1,09,200 (no rebate, no relief)", () => {
    const r = computeTax(1500000, "new", 2026);
    expect(r.baseTax).toBe(105000);
    expect(r.rebate).toBe(0);
    expect(r.totalTax).toBe(109200);
  });

  it("the paise path used by the payroll run applies the same relief", () => {
    expect(annualTaxFromTaxableMinor(121_000_000n, "new", 2026)).toBe(1_040_000n);
    expect(annualTaxFromTaxableMinor(127_000_000n, "new", 2026)).toBe(7_280_000n);
  });
});

describe("T-STAT F01: old regime keeps its own rebate, with no marginal relief", () => {
  it("Rs 5,00,000 -> 0; Rs 5,10,000 -> full slab tax Rs 14,500 + cess = Rs 15,080", () => {
    expect(tax(500000, "old")).toBe(0);
    const r = computeTax(510000, "old", 2026);
    expect(r.rebate).toBe(0);
    expect(r.totalTax).toBe(15080);
  });
});

describe("T-STAT F01: the rebate limit and relief follow the CONFIGURED FY", () => {
  it("FY 2024-25 (configured cap Rs 7,00,000): relief is measured from Rs 7 lakh, not Rs 12 lakh", () => {
    expect(getTaxConfig("new", 2024).rebateIncomeCap).toBe(700000);
    expect(tax(700000, "new", 2024)).toBe(0);
    // Slab tax 20,000 + 1,000 = 21,000; relief caps it at 10,000; + 4% cess.
    expect(tax(710000, "new", 2024)).toBe(10400);
  });

  it("a config row can switch marginal relief off explicitly (rebateMarginalRelief: false)", () => {
    const tenant = "7a5e0000-0000-4000-8000-0000000f0101";
    registerTaxConfig("new", 2026, { ...getTaxConfig("new", 2026), rebateMarginalRelief: false }, tenant);
    expect(computeTax(1210000, "new", 2026, tenant).totalTax).toBe(63960);
    // and the platform default is unaffected
    expect(tax(1210000)).toBe(10400);
  });
});
