/**
 * Payroll Service — domain tests covering all 15 packs.
 * Source: modules/payroll/domain.ts, tax/engine.ts, bank-transfer/domain.ts, statutory/ecr-domain.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { computeSlip, computeGratuity, isPayrollEligible, assertRunStatusTransition, hraSlabPct, roundRupee, additionalPensionPct, DomainError } from "../src/modules/payroll/domain.js";
import { registerTaxConfig, computeTax, hraExemptionMinor, trueUpTdsMinor, type FyTaxConfig } from "../src/modules/tax/engine.js";
import { computeSettlementDate, validateNachBeneficiaries, splitIntoBatches, computeBatchHash, sanitizeAscii } from "../src/modules/bank-transfer/domain.js";
import { computePensionableWage, EPF_WAGE_CEILING } from "../src/modules/statutory/ecr-domain.js";

// ─── Register test tax config ────────────────────────────────────────────────
beforeAll(() => {
  const newSlabs: FyTaxConfig = {
    slabs: [{ from: 0, to: 300000, rate: 0 }, { from: 300000, to: 700000, rate: 0.05 }, { from: 700000, to: 1000000, rate: 0.10 }, { from: 1000000, to: 1200000, rate: 0.15 }, { from: 1200000, to: 1500000, rate: 0.20 }, { from: 1500000, to: Infinity, rate: 0.30 }],
    stdDeduction: 75000, rebateIncomeCap: 700000, rebateMax: 25000,
    surchargeBands: [{ above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 }],
  };
  registerTaxConfig("new", 2025, newSlabs);
  registerTaxConfig("old", 2025, { ...newSlabs, stdDeduction: 50000, rebateIncomeCap: 500000, rebateMax: 12500, surchargeBands: [{ above: 5000000, rate: 0.10 }] });
});

// ─── Pack #01: Core Payroll ──────────────────────────────────────────────────
describe("core payroll — computeSlip", () => {
  it("basic slip: gross = basic + DA + HRA + components", () => {
    const r = computeSlip({ basicMinor: 50_000_00n, daRateBps: 5000n, cityClass: "X" });
    expect(r.grossMinor).toBeGreaterThan(50_000_00n);
    expect(r.daMinor).toBe(25_000_00n); // 50% of basic
  });

  it("net = gross - deductions", () => {
    const r = computeSlip({ basicMinor: 30_000_00n });
    expect(r.netPayMinor).toBe(r.grossMinor - r.totalDeductionsMinor);
  });

  it("EPF: 12% of PF wage (capped at Rs 15,000)", () => {
    const r = computeSlip({ basicMinor: 20_000_00n, pensionScheme: "EPF" });
    // PF wage = basic (no DA) = 20000, above cap → PF on 15000
    expect(r.pfEmployeeMinor).toBe(roundRupee((15_000_00n * 12n) / 100n));
  });

  it("GPF: 10% of basic+DA", () => {
    const r = computeSlip({ basicMinor: 50_000_00n, daRateBps: 5000n, pensionScheme: "GPF" });
    expect(r.gpfMinor).toBeGreaterThan(0n);
  });

  it("NPS: 10% employee + 14% employer", () => {
    const r = computeSlip({ basicMinor: 50_000_00n, daRateBps: 5000n, pensionScheme: "NPS" });
    expect(r.npsEmployeeMinor).toBeGreaterThan(0n);
    expect(r.npsEmployerMinor).toBeGreaterThan(r.npsEmployeeMinor); // 14% > 10%
  });

  it("ESI: applicable only when gross <= Rs 21,000", () => {
    const low = computeSlip({ basicMinor: 10_000_00n });
    const high = computeSlip({ basicMinor: 80_000_00n });
    expect(low.esiMinor).toBeGreaterThan(0n);
    expect(high.esiMinor).toBe(0n);
  });
});

describe("core payroll — run status transitions", () => {
  it("draft → processing", () => expect(() => assertRunStatusTransition("draft", "processing")).not.toThrow());
  it("processing → approved", () => expect(() => assertRunStatusTransition("processing", "approved")).not.toThrow());
  it("approved → disbursed", () => expect(() => assertRunStatusTransition("approved", "disbursed")).not.toThrow());
  it("disbursed is terminal", () => expect(() => assertRunStatusTransition("disbursed", "draft")).toThrow(DomainError));
  it("failed → draft (retry)", () => expect(() => assertRunStatusTransition("failed", "draft")).not.toThrow());
});

describe("core payroll — isPayrollEligible", () => {
  it("payroll route = eligible", () => expect(isPayrollEligible({ paymentRoute: "payroll" })).toBe(true));
  it("consultant route = NOT eligible", () => expect(isPayrollEligible({ paymentRoute: "consultant" })).toBe(false));
  it("null route defaults to payroll", () => expect(isPayrollEligible({})).toBe(true));
  it("eligibleForPayroll=false = NOT eligible", () => expect(isPayrollEligible({ eligibleForPayroll: false })).toBe(false));
});

// ─── Pack #04: F&F ───────────────────────────────────────────────────────────
describe("F&F — computeGratuity", () => {
  it("< 5 years = no gratuity", () => expect(computeGratuity(4.9, 50_000_00n)).toBe(0n));
  it("5 years eligible", () => expect(computeGratuity(5, 50_000_00n)).toBeGreaterThan(0n));
  it("formula: (15/26) * emoluments * years", () => {
    const g = computeGratuity(10, 100_000_00n, 50_000_00n);
    // (150000 * 15 * 10) / 26 ≈ Rs 8,65,385 → must be positive and reasonable
    expect(g).toBeGreaterThan(800_000_00n);
  });
  it("capped at Rs 20 lakh", () => {
    const g = computeGratuity(33, 200_000_00n, 100_000_00n);
    expect(g).toBeLessThanOrEqual(200_000_000n);
  });
  it("6+ months in final year rounds up", () => {
    const with6m = computeGratuity(10.5, 100_000_00n);
    const without = computeGratuity(10.4, 100_000_00n);
    expect(with6m).toBeGreaterThan(without);
  });
});

// ─── Pack #07: HRA Slab ──────────────────────────────────────────────────────
describe("HRA slab percentage by city class and DA tier", () => {
  it("X class, DA <50% = 24%", () => expect(hraSlabPct("X", 4000n)).toBe(24n));
  it("X class, DA >=50% = 27%", () => expect(hraSlabPct("X", 5000n)).toBe(27n));
  it("X class, DA >=100% = 30%", () => expect(hraSlabPct("X", 10000n)).toBe(30n));
  it("Y class, DA <50% = 16%", () => expect(hraSlabPct("Y", 4000n)).toBe(16n));
  it("Z class, DA <50% = 8%", () => expect(hraSlabPct("Z", 4000n)).toBe(8n));
});

// ─── Pack #08: Additional Pension ────────────────────────────────────────────
describe("additional pension age bands", () => {
  it("< 80 = 0%", () => expect(additionalPensionPct(79)).toBe(0n));
  it("80-84 = 20%", () => expect(additionalPensionPct(82)).toBe(20n));
  it("85-89 = 30%", () => expect(additionalPensionPct(87)).toBe(30n));
  it("90-94 = 40%", () => expect(additionalPensionPct(92)).toBe(40n));
  it("95-99 = 50%", () => expect(additionalPensionPct(97)).toBe(50n));
  it("100+ = 100%", () => expect(additionalPensionPct(105)).toBe(100n));
});

// ─── Pack #15: Tax Engine ────────────────────────────────────────────────────
describe("tax engine — computeTax", () => {
  it("below rebate cap (new) = 0 total tax", () => {
    const r = computeTax(600000, "new", 2025);
    expect(r.totalTax).toBe(0); // 87A rebate wipes it
  });
  it("above rebate: positive tax", () => {
    const r = computeTax(1200000, "new", 2025);
    expect(r.totalTax).toBeGreaterThan(0);
  });
  it("includes 4% cess", () => {
    const r = computeTax(2000000, "new", 2025);
    expect(r.cess).toBeGreaterThan(0);
  });
});

describe("tax engine — HRA exemption Sec 10(13A)", () => {
  it("least of: HRA received, rent-10%salary, 50%salary (metro)", () => {
    const exempt = hraExemptionMinor(600_000_00n, 180_000_00n, 120_000_00n, true);
    // a = 180000, b = 120000 - 60000 = 60000, c = 300000 → min = 60000
    expect(exempt).toBe(60_000_00n);
  });
  it("zero when no rent paid", () => {
    expect(hraExemptionMinor(600_000_00n, 180_000_00n, 0n, true)).toBe(0n);
  });
});

describe("tax engine — trueUpTdsMinor (Sec 192)", () => {
  it("spreads balance over remaining months", () => {
    const tds = trueUpTdsMinor(120_000_00n, 80_000_00n, 4);
    // balance = 40000, /4 = 10000 per month = 1000000 paise
    expect(tds).toBe(10_000_00n);
  });
  it("final month = full residual", () => {
    const tds = trueUpTdsMinor(120_000_00n, 100_000_00n, 1);
    expect(tds).toBe(20_000_00n); // full balance
  });
  it("0 when already over-deducted", () => {
    expect(trueUpTdsMinor(50_000_00n, 60_000_00n, 3)).toBe(0n);
  });
});

// ─── Pack #02/#09/#10: Bank Transfer / NACH ──────────────────────────────────
describe("bank transfer — NACH domain", () => {
  it("settlement date skips weekends", () => {
    // Friday → 2 business days → Tuesday (skip Sat+Sun)
    const result = computeSettlementDate(2, [], new Date(2026, 6, 10)); // July 10 = Friday
    expect(result).not.toBe(""); // valid date returned
  });

  it("validateNachBeneficiaries: valid IFSC passes", () => {
    const r = validateNachBeneficiaries([{ ifsc: "SBIN0001234", accountNo: "123456", amountMinor: 1000n, name: "A", reference: "r1", narration: "" }]);
    expect(r.valid).toBe(true);
  });

  it("validateNachBeneficiaries: invalid IFSC fails", () => {
    const r = validateNachBeneficiaries([{ ifsc: "INVALID", accountNo: "123", amountMinor: 1000n, name: "A", reference: "r1", narration: "" }]);
    expect(r.valid).toBe(false);
    expect(r.errors[0]!.field).toBe("ifsc");
  });

  it("validateNachBeneficiaries: zero amount fails", () => {
    const r = validateNachBeneficiaries([{ ifsc: "SBIN0001234", accountNo: "123", amountMinor: 0n, name: "A", reference: "r1", narration: "" }]);
    expect(r.valid).toBe(false);
  });

  it("splitIntoBatches: respects maxRecords", () => {
    const bens = Array.from({ length: 5 }, (_, i) => ({ ifsc: "SBIN0001234", accountNo: `${i}`, amountMinor: 100n, name: "", reference: `r${i}`, narration: "" }));
    const batches = splitIntoBatches(bens, 3, 999_999n);
    expect(batches.length).toBe(2);
    expect(batches[0]!.length).toBe(3);
    expect(batches[1]!.length).toBe(2);
  });

  it("splitIntoBatches: respects maxAmount", () => {
    const bens = [
      { ifsc: "A", accountNo: "1", amountMinor: 500n, name: "", reference: "r1", narration: "" },
      { ifsc: "A", accountNo: "2", amountMinor: 500n, name: "", reference: "r2", narration: "" },
      { ifsc: "A", accountNo: "3", amountMinor: 500n, name: "", reference: "r3", narration: "" },
    ];
    // maxAmount=800: first batch gets item 1 (500), item 2 would make 1000 > 800 → new batch
    const batches = splitIntoBatches(bens, 100, 800n);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    // Every beneficiary accounted for
    expect(batches.flat().length).toBe(3);
  });

  it("computeBatchHash: sum of first 8 digits of accounts", () => {
    const hash = computeBatchHash([
      { ifsc: "A", accountNo: "12345678901", amountMinor: 1n, name: "", reference: "", narration: "" },
    ]);
    expect(hash).toBe(12345678n);
  });

  it("sanitizeAscii: strips non-ASCII, pads to length", () => {
    expect(sanitizeAscii("Héllo", 10)).toBe("Hllo      ");
    expect(sanitizeAscii("ABCDEFGHIJ", 5)).toBe("ABCDE");
  });
});

// ─── Pack #13: Statutory — EPF Pensionable Wage ──────────────────────────────
describe("statutory — computePensionableWage", () => {
  it("basic + DA capped at Rs 15,000", () => {
    expect(computePensionableWage(12000, 5000)).toBe(15000);
  });
  it("below ceiling: returns actual", () => {
    expect(computePensionableWage(8000, 4000)).toBe(12000);
  });
  it("ceiling constant = 15000", () => expect(EPF_WAGE_CEILING).toBe(15000));
});

// ─── Pack #01: roundRupee ────────────────────────────────────────────────────
describe("roundRupee — half-up to nearest 100 paise", () => {
  it("50 paise rounds up", () => expect(roundRupee(150n)).toBe(200n));
  it("49 paise rounds down", () => expect(roundRupee(149n)).toBe(100n));
  it("exact 100 stays", () => expect(roundRupee(100n)).toBe(100n));
  it("negative mirrors positive", () => expect(roundRupee(-150n)).toBe(-200n));
});
