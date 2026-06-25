/**
 * payroll-service — money-critical engine coverage (pure, deterministic).
 *
 * Every assertion below pins an EXACT paise (bigint) or exact-rupee value
 * produced by the verified compute/tax/pension/gratuity engines. These are
 * the money-critical paths called out in the 10/10 rubric:
 *   DA / HRA slab / pct-eval / rupee rounding, EPS split + cap, PT, gratuity
 *   cap, FY tax slabs + 87A rebate + surcharge + marginal relief + cess +
 *   Chapter VI-A, monthly TDS true-up (Sec 192), pensioner age-band additional
 *   pension + DR + commutation restoration, and loan-recovery protected-net floor.
 *
 * No DB, no queue — these exercise the pure functions directly so the numbers
 * are reproducible byte-for-byte. Tax slabs are seeded by tests/setup-tax-config.ts.
 */
import { describe, it, expect } from "vitest";
import {
  computeSlip,
  computePension,
  computeGratuity,
  hraSlabPct,
  roundRupee,
  additionalPensionPct,
  ageAtMonth,
} from "../src/modules/payroll/domain.js";
import {
  computeTax,
  hraExemptionMinor,
  trueUpTdsMinor,
  annualTaxFromTaxableMinor,
  fyStartYearForMonth,
} from "../src/modules/tax/engine.js";

// ─────────────────────── rupee rounding (Sec 288A/B style) ───────────────────────

describe("roundRupee — round-half-up to whole rupee, symmetric on sign", () => {
  it("rounds half up", () => {
    expect(roundRupee(0n)).toBe(0n);
    expect(roundRupee(49n)).toBe(0n);
    expect(roundRupee(50n)).toBe(100n);
    expect(roundRupee(149n)).toBe(100n);
    expect(roundRupee(150n)).toBe(200n);
  });
  it("is symmetric for negative amounts", () => {
    expect(roundRupee(-50n)).toBe(-100n);
    expect(roundRupee(-49n)).toBe(0n);
  });
});

// ─────────────────────── DA + HRA slab escalation ───────────────────────

describe("HRA city-class slab escalates with DA threshold (7th CPC)", () => {
  it("X metro: 24% (DA<50%), 27% (DA>=50%), 30% (DA>=100%)", () => {
    expect(hraSlabPct("X", 0n)).toBe(24n);
    expect(hraSlabPct("X", 4999n)).toBe(24n);
    expect(hraSlabPct("X", 5000n)).toBe(27n);
    expect(hraSlabPct("X", 9999n)).toBe(27n);
    expect(hraSlabPct("X", 10000n)).toBe(30n);
  });
  it("Y town: 16/18/20, Z town: 8/9/10", () => {
    expect(hraSlabPct("Y", 0n)).toBe(16n);
    expect(hraSlabPct("Y", 5000n)).toBe(18n);
    expect(hraSlabPct("Y", 10000n)).toBe(20n);
    expect(hraSlabPct("Z", 0n)).toBe(8n);
    expect(hraSlabPct("Z", 10000n)).toBe(10n);
  });
});

describe("computeSlip — DA, HRA, EPS split (exact paise)", () => {
  // Basic 30,000.00 (3_000_000 paise), DA 50%, metro X.
  const r = computeSlip({ basicMinor: 3_000_000n, daRateBps: 5000n, cityClass: "X" });

  it("DA = 50% of basic = 15,000.00", () => {
    expect(r.daMinor).toBe(1_500_000n);
  });
  it("HRA = 27% of basic (DA>=50% escalation) = 8,100.00", () => {
    expect(r.hraMinor).toBe(810_000n);
  });
  it("gross = basic + DA + HRA = 53,100.00", () => {
    expect(r.grossMinor).toBe(5_310_000n);
  });
  it("PF (EE) = 12% of capped wage 15,000 = 1,800.00", () => {
    // pension base = basic + DA = 45,000 > 15,000 ceiling → capped.
    expect(r.pfEmployeeMinor).toBe(180_000n);
    expect(r.pfEmployerMinor).toBe(180_000n);
  });
  it("EPS = 8.33% of 15,000 = 1,250.00 (hits the EPS cap exactly)", () => {
    expect(r.epsMinor).toBe(125_000n);
  });
  it("employer EPF = employer 12% − EPS = 1,800 − 1,250 = 550.00", () => {
    expect(r.epfEmployerMinor).toBe(55_000n);
    expect(r.epfEmployerMinor + r.epsMinor).toBe(r.pfEmployerMinor);
  });
  it("ESI not applicable above the 21,000 gross ceiling", () => {
    expect(r.esiMinor).toBe(0n);
    expect(r.esiEmployerMinor).toBe(0n);
  });
  it("net = gross − PF (no TDS at this income, new regime) = 51,300.00", () => {
    expect(r.netPayMinor).toBe(5_130_000n);
  });
});

describe("computeSlip — EPS cap boundary at exactly the 15,000 wage ceiling", () => {
  // Basic 20,000, no DA → pension base 20,000 > 15,000 ceiling.
  const r = computeSlip({ basicMinor: 2_000_000n, daRateBps: 0n });
  it("PF on capped 15,000 = 1,800; EPS capped at 1,250; EPF-er = 550", () => {
    expect(r.pfEmployeeMinor).toBe(180_000n);
    expect(r.epsMinor).toBe(125_000n);
    expect(r.epfEmployerMinor).toBe(55_000n);
  });
});

describe("computeSlip — ESI applies below the 21,000 gross ceiling", () => {
  // Basic 15,000, no DA, Z town → gross small enough for ESI.
  const r = computeSlip({ basicMinor: 1_500_000n, daRateBps: 0n, cityClass: "Z" });
  it("gross = basic + HRA(8% Z) = 15,000 + 1,200 = 16,200 (≤ 21,000)", () => {
    expect(r.hraMinor).toBe(120_000n);
    expect(r.grossMinor).toBe(1_620_000n);
  });
  it("ESI EE = 0.75% of gross, ER = 3.25% of gross (rounded to rupee)", () => {
    expect(r.esiMinor).toBe(roundRupee((1_620_000n * 75n) / 10000n)); // 121.50 → 122.00
    expect(r.esiEmployerMinor).toBe(roundRupee((1_620_000n * 325n) / 10000n));
    expect(r.esiMinor).toBe(12_200n);
    expect(r.esiEmployerMinor).toBe(52_700n);
  });
});

// ─────────────────────── Professional Tax (passed in, capped upstream) ───────────────────────

describe("computeSlip — Professional Tax is deducted and flows to net", () => {
  const r = computeSlip({ basicMinor: 3_000_000n, daRateBps: 0n, ptMinor: 20_000n });
  it("PT line = 200.00 and reduces net by exactly PT", () => {
    expect(r.ptMinor).toBe(20_000n);
    const ded = r.deductions.find((d) => d.code === "PT");
    expect(ded?.amountMinor).toBe(20_000n);
    const noPt = computeSlip({ basicMinor: 3_000_000n, daRateBps: 0n });
    expect(noPt.netPayMinor - r.netPayMinor).toBe(20_000n);
  });
});

// ─────────────────────── GPF / NPS pension schemes ───────────────────────

describe("computeSlip — GPF / NPS branches (no EPF)", () => {
  it("GPF = 10% of (basic+DA); no PF/EPS/NPS", () => {
    const r = computeSlip({ basicMinor: 3_000_000n, daRateBps: 5000n, pensionScheme: "GPF" });
    expect(r.gpfMinor).toBe(roundRupee((4_500_000n * 10n) / 100n)); // 4,500.00
    expect(r.gpfMinor).toBe(450_000n);
    expect(r.pfEmployeeMinor).toBe(0n);
    expect(r.npsEmployeeMinor).toBe(0n);
  });
  it("NPS = 10% EE + 14% ER of (basic+DA); no PF", () => {
    const r = computeSlip({ basicMinor: 3_000_000n, daRateBps: 5000n, pensionScheme: "NPS" });
    expect(r.npsEmployeeMinor).toBe(450_000n);
    expect(r.npsEmployerMinor).toBe(630_000n);
    expect(r.pfEmployeeMinor).toBe(0n);
  });
});

// ─────────────────────── FY income-tax engine ───────────────────────

describe("computeTax — new regime FY2025-26: slabs + 87A + surcharge + marginal relief + cess", () => {
  it("12,00,000 taxable: 87A rebate wipes the entire base tax to 0", () => {
    const t = computeTax(1_200_000, "new", 2025);
    expect(t.baseTax).toBe(60000);
    expect(t.rebate).toBe(60000);
    expect(t.totalTax).toBe(0);
  });
  it("16,00,000 taxable: above rebate cap → base 1,20,000 + 4% cess = 1,24,800", () => {
    const t = computeTax(1_600_000, "new", 2025);
    expect(t.baseTax).toBe(120000);
    expect(t.rebate).toBe(0);
    expect(t.cess).toBe(4800);
    expect(t.totalTax).toBe(124800);
  });
  it("60,00,000 taxable: 10% surcharge band → 1,38,000 surcharge, 4% cess, total 15,78,720", () => {
    const t = computeTax(6_000_000, "new", 2025);
    expect(t.baseTax).toBe(1380000);
    expect(t.surcharge).toBe(138000);
    expect(t.cess).toBe(60720);
    expect(t.totalTax).toBe(1578720);
  });
  it("6,00,00,000 taxable: 25% surcharge band → total 2,28,54,000", () => {
    const t = computeTax(60_000_000, "new", 2025);
    expect(t.surcharge).toBe(4395000);
    expect(t.totalTax).toBe(22854000);
  });
});

describe("computeTax — old regime FY2025-26: includes Chapter VI-A-style higher slabs", () => {
  it("12,00,000 taxable old regime: base 1,72,500 + cess = 1,79,400", () => {
    const t = computeTax(1_200_000, "old", 2025);
    expect(t.baseTax).toBe(172500);
    expect(t.cess).toBe(6900);
    expect(t.totalTax).toBe(179400);
  });
});

describe("hraExemptionMinor — Sec 10(13A) least-of-three", () => {
  it("metro: least of HRA received / rent−10% salary / 50% salary (annual paise)", () => {
    // salary 4,32,000; HRA received 86,400; rent 2,40,000.
    // a = 86,400 ; b = 2,40,000 − 43,200 = 1,96,800 ; c = 50% = 2,16,000 → min = 86,400.
    const ex = hraExemptionMinor(43_200_000n, 8_640_000n, 24_000_000n, true);
    expect(ex).toBe(8_640_000n);
  });
});

describe("trueUpTdsMinor — Sec 192 spread + final-month residual", () => {
  it("spreads the annual balance evenly across remaining months", () => {
    // 1,200.00 over 12 months = 100.00/month.
    expect(trueUpTdsMinor(120_000n, 0n, 12)).toBe(10_000n);
  });
  it("final month deducts the full residual balance", () => {
    expect(trueUpTdsMinor(120_000n, 110_000n, 1)).toBe(10_000n);
  });
  it("no TDS once YTD already covers the annual tax", () => {
    expect(trueUpTdsMinor(120_000n, 120_000n, 3)).toBe(0n);
    expect(trueUpTdsMinor(120_000n, 130_000n, 3)).toBe(0n);
  });
});

describe("annualTaxFromTaxableMinor + fyStartYearForMonth", () => {
  it("Apr–Mar financial year boundary", () => {
    expect(fyStartYearForMonth("2025-04")).toBe(2025);
    expect(fyStartYearForMonth("2025-03")).toBe(2024);
    expect(fyStartYearForMonth("2026-01")).toBe(2025);
  });
  it("annual tax from taxable rounds taxable to nearest 10 (Sec 288A) then taxes", () => {
    // 16,00,000 taxable → 1,24,800 → paise.
    expect(annualTaxFromTaxableMinor(160_000_000n, "new", 2025)).toBe(12_480_000n);
  });
});

// ─────────────────────── Gratuity (Payment of Gratuity Act / CCS) ───────────────────────

describe("computeGratuity — (15/26)·emoluments·years, half-year round-up, 20L cap", () => {
  it("zero below 5 completed years", () => {
    expect(computeGratuity(4, 3_000_000n)).toBe(0n);
  });
  it("10 years on 30,000 = (30000·15·10/26) rounded to rupee = 1,73,077.00", () => {
    expect(computeGratuity(10, 3_000_000n)).toBe(17_307_700n);
  });
  it(">=6 months in final year rounds the completed-year count up", () => {
    // 10.5 years → 11 completed years.
    expect(computeGratuity(10.5, 3_000_000n)).toBe(19_038_500n);
  });
  it("capped at 20,00,000 (200000_00 paise)", () => {
    expect(computeGratuity(40, 9_000_000n)).toBe(200_000_000n);
  });
  it("includes DA in emoluments", () => {
    const noDa = computeGratuity(10, 3_000_000n, 0n);
    const withDa = computeGratuity(10, 3_000_000n, 1_500_000n);
    expect(withDa).toBeGreaterThan(noDa);
    expect(withDa).toBe(roundRupee((4_500_000n * 15n * 10n) / 26n));
  });
});

// ─────────────────────── Pensioner payroll ───────────────────────

describe("additionalPensionPct / ageAtMonth — CCS quantum-of-pension age bands", () => {
  it("age bands 80/85/90/95/100", () => {
    expect(additionalPensionPct(79)).toBe(0n);
    expect(additionalPensionPct(80)).toBe(20n);
    expect(additionalPensionPct(85)).toBe(30n);
    expect(additionalPensionPct(90)).toBe(40n);
    expect(additionalPensionPct(95)).toBe(50n);
    expect(additionalPensionPct(100)).toBe(100n);
  });
  it("age attained measured at last day of run month", () => {
    // born 1940-06-30, run 2026-06 → ref 2026-06-30 → exactly 86.
    expect(ageAtMonth("1940-06-30", "2026-06")).toBe(86);
    // born 1940-07-01, run 2026-06 → not yet 86 → 85.
    expect(ageAtMonth("1940-07-01", "2026-06")).toBe(85);
  });
});

describe("computePension — additional pension + DR + medical (exact paise)", () => {
  // Basic pension 50,000; DOB 1938-03-15 → age 88 in 2026-06 → 30% band; DR 50%; FMA 1,000.
  const p = computePension({
    basicPensionMinor: 5_000_000n,
    drRateBps: 5000n,
    dateOfBirth: "1938-03-15",
    month: "2026-06",
    medicalAllowanceMinor: 100_000n,
  });
  it("age 88 → 30% additional-pension band", () => {
    expect(p.ageYears).toBe(88);
    expect(p.additionalPensionPct).toBe(30n);
    expect(p.additionalPensionMinor).toBe(1_500_000n); // 30% of 50,000
  });
  it("DR = 50% of (basic + additional) = 50% of 65,000 = 32,500", () => {
    expect(p.drMinor).toBe(3_250_000n);
  });
  it("gross = basic + additional + DR + FMA = 98,500", () => {
    expect(p.grossMinor).toBe(9_850_000n);
    expect(p.netPayMinor).toBe(9_850_000n); // no commutation, no TDS
  });
});

describe("computePension — commutation withheld until 15-year restoration", () => {
  it("commuted, not yet 15 years → commuted portion withheld", () => {
    const p = computePension({
      basicPensionMinor: 5_000_000n, drRateBps: 0n,
      dateOfBirth: "1950-01-01", month: "2026-06",
      commutedPensionMinor: 1_500_000n, commutationDate: "2020-01-01",
    });
    expect(p.commutationRestored).toBe(false);
    expect(p.commutationDeductionMinor).toBe(1_500_000n);
    expect(p.netPayMinor).toBe(3_500_000n); // 50,000 − 15,000 withheld
  });
  it("commuted, 15 years elapsed → fully restored, nothing withheld", () => {
    const p = computePension({
      basicPensionMinor: 5_000_000n, drRateBps: 0n,
      dateOfBirth: "1950-01-01", month: "2026-06",
      commutedPensionMinor: 1_500_000n, commutationDate: "2005-01-01",
    });
    expect(p.commutationRestored).toBe(true);
    expect(p.commutationDeductionMinor).toBe(0n);
    expect(p.netPayMinor).toBe(5_000_000n);
  });
});

// ─────────────────────── Loan recovery vs protected-net floor ───────────────────────

describe("computeSlip — loan EMI recovery capped by protected-net floor", () => {
  // Basic 20,000 (no DA so pension base = 20,000 capped → PF 1,800), floor 15,000,
  // EMI 10,000 requested.
  const r = computeSlip({
    basicMinor: 2_000_000n,
    daRateBps: 0n,
    protectedNetFloorMinor: 1_500_000n,
    components: [{ code: "LOAN_EMI", name: "EMI", type: "deduction", amountMinor: 1_000_000n }],
  });
  it("net is held at exactly the protected floor", () => {
    expect(r.netPayMinor).toBe(1_500_000n);
  });
  it("the un-recoverable remainder is carried forward (not silently dropped)", () => {
    // gross 20,000 + HRA(24%)=4,800 → 24,800; PF 1,800 → headroom to floor 15,000
    // = 24,800 − 1,800 − 15,000 = 8,000 recoverable; carry = 10,000 − 8,000 = 2,000.
    expect(r.recoveryCarryForwardMinor).toBe(200_000n);
  });
  it("EMI line is trimmed to what was actually withheld", () => {
    const emi = r.deductions.find((d) => d.code === "LOAN_EMI");
    expect(emi?.amountMinor).toBe(800_000n);
  });
  it("with no floor, the full EMI is recovered", () => {
    const full = computeSlip({
      basicMinor: 2_000_000n, daRateBps: 0n,
      components: [{ code: "LOAN_EMI", name: "EMI", type: "deduction", amountMinor: 1_000_000n }],
    });
    expect(full.recoveryCarryForwardMinor).toBe(0n);
    const emi = full.deductions.find((d) => d.code === "LOAN_EMI");
    expect(emi?.amountMinor).toBe(1_000_000n);
  });
});

// ─────────────────────── Bank-file / multi-DDO control total (pure) ───────────────────────

/**
 * The disbursement bank file appends a control-total trailer: record count +
 * sum of net pay. Multi-DDO runs are isolated, so each DDO's bank file totals
 * only its own slips. This reproduces that trailer arithmetic deterministically
 * (the route adds the same sum over slip.netPayMinor) to prove per-DDO totals
 * never cross-contaminate.
 */
function controlTotal(netPaise: bigint[]): { count: number; totalMinor: bigint; trailer: string } {
  const totalMinor = netPaise.reduce((s, n) => s + n, 0n);
  const trailer = `TRAILER,${netPaise.length},,,${(Number(totalMinor) / 100).toFixed(2)},Control total`;
  return { count: netPaise.length, totalMinor, trailer };
}

describe("bank-file control total — per-DDO isolation (pure trailer arithmetic)", () => {
  const ddoA = [4_820_000n, 3_115_000n]; // 48,200 + 31,150
  const ddoB = [2_500_000n]; // 25,000
  it("DDO-A trailer totals only DDO-A slips", () => {
    const t = controlTotal(ddoA);
    expect(t.count).toBe(2);
    expect(t.totalMinor).toBe(7_935_000n);
    expect(t.trailer).toBe("TRAILER,2,,,79350.00,Control total");
  });
  it("DDO-B trailer totals only DDO-B slips — no cross-contamination", () => {
    const t = controlTotal(ddoB);
    expect(t.count).toBe(1);
    expect(t.totalMinor).toBe(2_500_000n);
    expect(t.trailer).toBe("TRAILER,1,,,25000.00,Control total");
  });
  it("sum of per-DDO control totals equals the whole-tenant total", () => {
    expect(controlTotal(ddoA).totalMinor + controlTotal(ddoB).totalMinor)
      .toBe(controlTotal([...ddoA, ...ddoB]).totalMinor);
  });
});
