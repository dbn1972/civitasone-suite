/**
 * INDEPENDENT payroll oracle — ERP reconciliation assessment (lane 11).
 *
 * This file does NOT trust the production compute engine as its own oracle.
 * It re-derives expected gross / deductions / net / tax from first principles
 * (statutory formulae re-implemented here) and compares against computeSlip /
 * computeGratuity / computePension. Tax config is auto-registered by
 * tests/setup-tax-config.ts (vitest setupFiles).
 */
import { describe, it, expect } from "vitest";
import {
  computeSlip,
  computeGratuity,
  computePension,
  type SlipInput,
} from "../src/modules/payroll/domain.js";

// ─────────────────── Independent statutory helpers (oracle) ───────────────────
// Re-implemented from the IT Act / 7th CPC — intentionally NOT importing engine.

function roundRupeePaise(x: bigint): bigint {
  if (x < 0n) return -roundRupeePaise(-x);
  return ((x + 50n) / 100n) * 100n;
}
function pctBasic(basePaise: bigint, percent: bigint): bigint {
  return roundRupeePaise((basePaise * percent) / 100n);
}
// New-regime FY2025-26 slabs (independent copy of the STATUTE, not the engine).
function taxNew2025(taxableRupees: number): number {
  const t = Math.round(Math.max(0, taxableRupees) / 10) * 10; // Sec 288A
  const slabs: [number, number, number][] = [
    [0, 400000, 0], [400000, 800000, 0.05], [800000, 1200000, 0.10],
    [1200000, 1600000, 0.15], [1600000, 2000000, 0.20],
    [2000000, 2400000, 0.25], [2400000, Infinity, 0.30],
  ];
  let rem = t, slab = 0;
  for (const [from, to, rate] of slabs) {
    if (rem <= 0) break;
    const width = to === Infinity ? rem : to - from;
    const inSlab = Math.min(rem, width);
    slab += inSlab * rate;
    rem -= inSlab;
  }
  slab = Math.round(slab);
  const rebate = t <= 1200000 ? Math.min(slab, 60000) : 0;
  const afterRebate = Math.max(0, slab - rebate);
  // surcharge bands new: >50L 10%, >1cr 15%, >2cr 25%
  let scRate = 0;
  if (t > 5000000) scRate = 0.10;
  if (t > 10000000) scRate = 0.15;
  if (t > 20000000) scRate = 0.25;
  let surcharge = Math.round(afterRebate * scRate);
  const cess = Math.round((afterRebate + surcharge) * 0.04);
  return Math.round((afterRebate + surcharge + cess) / 10) * 10;
}
function annualTaxNewPaise(taxablePaise: bigint): bigint {
  return BigInt(taxNew2025(Number(taxablePaise) / 100)) * 100n;
}
// PF/EPS on basic+DA capped at 15,000 wage ceiling.
function pfBlock(pensionBasePaise: bigint) {
  const cap = 1_500_000n;
  const wage = pensionBasePaise > cap ? cap : pensionBasePaise;
  const pfEmployee = pctBasic(wage, 12n);
  let eps = roundRupeePaise((wage * 833n) / 10000n);
  if (eps > 125_000n) eps = 125_000n;
  return { pfEmployee, eps, epfEmployer: pctBasic(wage, 12n) - eps };
}

interface Expect {
  gross: bigint; net: bigint; deductions: bigint;
  da: bigint; hra: bigint; pfEmployee: bigint; eps: bigint; tds: bigint;
  negativeNet?: boolean; carryForward?: bigint;
}

const results: Array<{ name: string; field: string; expected: string; actual: string; ok: boolean }> = [];
function cmp(name: string, field: string, expected: bigint, actual: bigint) {
  const ok = expected === actual;
  results.push({ name, field, expected: expected.toString(), actual: actual.toString(), ok });
  return ok;
}

function checkSlip(name: string, input: SlipInput, e: Expect) {
  const r = computeSlip(input);
  cmp(name, "gross", e.gross, r.grossMinor);
  cmp(name, "da", e.da, r.daMinor);
  cmp(name, "hra", e.hra, r.hraMinor);
  cmp(name, "pfEmployee", e.pfEmployee, r.pfEmployeeMinor);
  cmp(name, "eps", e.eps, r.epsMinor);
  cmp(name, "tds", e.tds, r.tdsMinor);
  cmp(name, "deductions", e.deductions, r.totalDeductionsMinor);
  cmp(name, "net", e.net, r.netPayMinor);
  if (e.negativeNet !== undefined) cmp(name, "negativeNet", e.negativeNet ? 1n : 0n, r.negativeNet ? 1n : 0n);
  if (e.carryForward !== undefined) cmp(name, "carryForward", e.carryForward, r.recoveryCarryForwardMinor);
  // Internal reconciliation invariant: gross - deductions == net (unless negative-net floored).
  if (!r.negativeNet) cmp(name, "INVARIANT gross-ded=net", r.grossMinor - r.totalDeductionsMinor, r.netPayMinor);
  return r;
}

describe("INDEPENDENT ORACLE vs computeSlip", () => {
  // ── Case 1: Standard employee ──
  it("Case 1 — standard employee (basic 50k, DA 50%, X, EPF, new)", () => {
    const basic = 5_000_000n, da = 2_500_000n, hra = pctBasic(basic, 27n);
    const gross = basic + da + hra;
    const { pfEmployee, eps } = pfBlock(basic + da);
    const annualTaxable = gross * 12n - 7_500_000n; // new std ded 75k
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n;
    const ded = pfEmployee + tds;
    checkSlip("C1 standard", { basicMinor: basic, daRateBps: 5000n, cityClass: "X" },
      { gross, da, hra, pfEmployee, eps, tds, deductions: ded, net: gross - ded });
  });

  // ── Case 2: Mid-month join (pro-rated basic 15/30) ──
  it("Case 2 — mid-month join (pro-rated basic 25k)", () => {
    const basic = 2_500_000n, da = 1_250_000n, hra = pctBasic(basic, 27n);
    const gross = basic + da + hra;
    const { pfEmployee, eps } = pfBlock(basic + da);
    const annualTaxable = gross * 12n - 7_500_000n;
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n;
    const ded = pfEmployee + tds;
    checkSlip("C2 join", { basicMinor: basic, daRateBps: 5000n, cityClass: "X" },
      { gross, da, hra, pfEmployee, eps, tds, deductions: ded, net: gross - ded });
  });

  // ── Case 3: Mid-month exit (pro-rated basic 20k + LOP recovery, floor guarded) ──
  it("Case 3 — mid-month exit (pro-rated basic 20k, LOP 3k recovery, floor 0)", () => {
    const basic = 2_000_000n, da = 1_000_000n, hra = pctBasic(basic, 27n);
    const gross = basic + da + hra;
    const { pfEmployee, eps } = pfBlock(basic + da);
    const lop = 300_000n; // recovery code
    const annualTaxable = gross * 12n - 7_500_000n;
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n;
    // floor 0 => full LOP recovered
    const ded = pfEmployee + tds + lop;
    checkSlip("C3 exit", {
      basicMinor: basic, daRateBps: 5000n, cityClass: "X",
      components: [{ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: lop }],
    }, { gross, da, hra, pfEmployee, eps, tds, deductions: ded, net: gross - ded, carryForward: 0n });
  });

  // ── Case 4: LOP month (full basic 50k, 5 days LOP) ──
  it("Case 4 — LOP month (basic 50k, LOP 5 days ≈ 12,500)", () => {
    const basic = 5_000_000n, da = 2_500_000n, hra = pctBasic(basic, 27n);
    const gross = basic + da + hra;
    const { pfEmployee, eps } = pfBlock(basic + da);
    const lop = 1_250_000n;
    const annualTaxable = gross * 12n - 7_500_000n;
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n;
    const ded = pfEmployee + tds + lop;
    checkSlip("C4 LOP", {
      basicMinor: basic, daRateBps: 5000n, cityClass: "X",
      components: [{ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: lop }],
    }, { gross, da, hra, pfEmployee, eps, tds, deductions: ded, net: gross - ded, carryForward: 0n });
  });

  // ── Case 5: Promotion-in-month (new basic 60k + promo arrear earning 5k) ──
  it("Case 5 — promotion in month (basic 60k + PROMO_ARREAR 5k)", () => {
    const basic = 6_000_000n, da = 3_000_000n, hra = pctBasic(basic, 27n);
    const promo = 500_000n;
    const gross = basic + da + hra + promo;
    const { pfEmployee, eps } = pfBlock(basic + da);
    const annualTaxable = gross * 12n - 7_500_000n;
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n;
    const ded = pfEmployee + tds;
    checkSlip("C5 promo", {
      basicMinor: basic, daRateBps: 5000n, cityClass: "X",
      components: [{ code: "PROMO_ARREAR", name: "Promotion Arrear", type: "earning", amountMinor: promo }],
    }, { gross, da, hra, pfEmployee, eps, tds, deductions: ded, net: gross - ded });
  });

  // ── Case 6: Retrospective increment (arrears earning 20k, taxable) ──
  it("Case 6 — retrospective increment (basic 50k + ARREAR 20k)", () => {
    const basic = 5_000_000n, da = 2_500_000n, hra = pctBasic(basic, 27n);
    const arrear = 2_000_000n;
    const gross = basic + da + hra + arrear;
    const { pfEmployee, eps } = pfBlock(basic + da);
    const annualTaxable = gross * 12n - 7_500_000n;
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n;
    const ded = pfEmployee + tds;
    checkSlip("C6 arrear", {
      basicMinor: basic, daRateBps: 5000n, cityClass: "X",
      components: [{ code: "ARREAR", name: "Arrears", type: "earning", amountMinor: arrear }],
    }, { gross, da, hra, pfEmployee, eps, tds, deductions: ded, net: gross - ded });
  });

  // ── Case 7a: Negative-net guard (basic 10k, non-recovery attach 2L > gross) ──
  it("Case 7a — negative net guard (basic 10k, COURT_ATTACH 200k fixed)", () => {
    const basic = 1_000_000n, da = 500_000n, hra = pctBasic(basic, 27n);
    const gross = basic + da + hra;
    const { pfEmployee, eps } = pfBlock(basic + da);
    const attach = 20_000_000n; // non-recovery fixed deduction
    const annualTaxable = gross * 12n - 7_500_000n;
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n; // 0
    const esi = gross <= 2_100_000n ? roundRupeePaise((gross * 75n) / 10000n) : 0n; // gross < 21k
    const ded = pfEmployee + esi + tds + attach; // > gross
    checkSlip("C7a negNet", {
      basicMinor: basic, daRateBps: 5000n, cityClass: "X",
      components: [{ code: "COURT_ATTACH", name: "Court Attachment", type: "deduction", amountMinor: attach }],
    }, { gross, da, hra, pfEmployee, eps, tds, deductions: ded, net: 0n, negativeNet: true });
  });

  // ── Case 7b: Protected-net floor caps LOAN_EMI recovery, carry-forward remainder ──
  it("Case 7b — protected-net floor caps recovery (basic 30k, EMI 40k, floor 25k)", () => {
    const basic = 3_000_000n, da = 1_500_000n, hra = pctBasic(basic, 27n);
    const gross = basic + da + hra;
    const { pfEmployee, eps } = pfBlock(basic + da);
    const emi = 4_000_000n;      // recovery code LOAN_EMI
    const floor = 2_500_000n;    // protected net floor 25k
    const annualTaxable = gross * 12n - 7_500_000n;
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n;
    const nonRecovery = pfEmployee + tds;
    const headroom = gross - nonRecovery - floor;
    const recoveryApplied = emi > headroom ? (headroom < 0n ? 0n : headroom) : emi;
    const carry = emi - recoveryApplied;
    const ded = nonRecovery + recoveryApplied;
    checkSlip("C7b floor", {
      basicMinor: basic, daRateBps: 5000n, cityClass: "X",
      protectedNetFloorMinor: floor,
      components: [{ code: "LOAN_EMI", name: "Loan EMI", type: "deduction", amountMinor: emi }],
    }, { gross, da, hra, pfEmployee, eps, tds, deductions: ded, net: gross - ded, carryForward: carry });
  });

  // ── Case 8: Off-cycle/supplementary (basic 0, BONUS 30k earning only) ──
  it("Case 8 — off-cycle supplementary (basic 0, BONUS 30k)", () => {
    const bonus = 3_000_000n;
    const gross = bonus;
    // pensionBase 0 => no PF
    const annualTaxable = gross * 12n - 7_500_000n; // 36,000,000-7,500,000=28,500,000 => 285,000 rupees
    const tds = annualTaxNewPaise(annualTaxable) / 100n / 12n * 100n;
    const ded = tds;
    checkSlip("C8 offcycle", {
      basicMinor: 0n, cityClass: "X",
      components: [{ code: "BONUS", name: "Bonus", type: "earning", amountMinor: bonus }],
    }, { gross, da: 0n, hra: 0n, pfEmployee: 0n, eps: 0n, tds, deductions: ded, net: gross - ded });
  });

  // ── Gratuity (PG Act cap) ──
  it("Gratuity — 11.5 yrs, last B+DA 80k → 15/26 formula, cap 20L", () => {
    const g = computeGratuity(11.5, 8_000_000n, 0n);
    // 11.5 -> whole 11, frac 6 -> +1 = 12 completed years; (80000*15*12)/26 paise
    const emol = 8_000_000n;
    const expected = roundRupeePaise((emol * 15n * 12n) / 26n);
    cmp("Gratuity", "amount", expected > 200_000_000n ? 200_000_000n : expected, g);
    expect(g).toBe(expected > 200_000_000n ? 200_000_000n : expected);
  });

  it("Gratuity cap — huge salary clamps to 20L", () => {
    const g = computeGratuity(30, 50_000_000n, 10_000_000n);
    cmp("GratuityCap", "amount", 200_000_000n, g);
    expect(g).toBe(200_000_000n);
  });

  // ── Pension (age band + DR + commutation) ──
  it("Pension — age 86 (30% addl), DR 50%, no commutation", () => {
    const r = computePension({
      basicPensionMinor: 5_000_000n, drRateBps: 5000n,
      dateOfBirth: "1939-01-01", month: "2025-06",
    });
    const addl = pctBasic(5_000_000n, 30n);
    const drBase = 5_000_000n + addl;
    const dr = roundRupeePaise((drBase * 5000n) / 10000n);
    const gross = 5_000_000n + addl + dr;
    cmp("Pension", "addl", addl, r.additionalPensionMinor);
    cmp("Pension", "dr", dr, r.drMinor);
    cmp("Pension", "gross", gross, r.grossMinor);
    cmp("Pension", "net", gross, r.netPayMinor);
  });

  it("PRINT RESULTS TABLE", () => {
    const line = (c: string) => c.padEnd(1);
    let out = "\n===== INDEPENDENT ORACLE COMPARISON =====\n";
    let pass = 0, fail = 0;
    for (const r of results) {
      out += `${r.ok ? "PASS" : "FAIL"} | ${r.name.padEnd(14)} | ${r.field.padEnd(26)} | exp=${r.expected.padEnd(12)} act=${r.actual}\n`;
      r.ok ? pass++ : fail++;
    }
    out += `----- ${pass} matched, ${fail} mismatched -----\n`;
    console.log(out);
    void line;
    expect(fail).toBe(0);
  });
});
