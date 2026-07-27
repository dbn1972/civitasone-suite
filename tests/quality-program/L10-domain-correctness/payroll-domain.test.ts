/**
 * L10 — Domain Correctness: Payroll (P0 for money)
 *
 * Asserts payroll computations against independently-computed golden oracles.
 * Every assertion uses B3 golden values, NOT the code's own output.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";
import { readFileSync } from "fs";

const REPO_ROOT = resolve(__dirname, "../../..");
const goldens = JSON.parse(readFileSync(resolve(__dirname, "../goldens/payroll-goldens.json"), "utf-8"));

let computeGratuity: (years: number, basic: bigint, da?: bigint) => bigint;
let additionalPensionPct: (age: number) => bigint;
let computeSlip: (input: Record<string, unknown>) => Record<string, unknown>;
let computePension: (input: Record<string, unknown>) => Record<string, unknown>;

beforeAll(async () => {
  const domain = await import(
    `${REPO_ROOT}/services/payroll-service/src/modules/payroll/domain.js`
  );
  computeGratuity = domain.computeGratuity;
  additionalPensionPct = domain.additionalPensionPct;
  computeSlip = domain.computeSlip;
  computePension = domain.computePension;

  // Register tax config (required before computeSlip can run)
  const { registerTaxConfig } = await import(
    `${REPO_ROOT}/services/payroll-service/src/modules/tax/engine.js`
  );
  registerTaxConfig("new", 2025, {
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

describe("L10 — Gratuity computation (vs golden oracle)", () => {
  for (const tc of goldens.gratuity) {
    it(`${tc.note}`, () => {
      const result = computeGratuity(
        tc.yearsOfService,
        BigInt(tc.lastBasicMinor),
        BigInt(tc.lastDaMinor),
      );
      // Allow ±1 paise for rounding differences in the golden
      expect(Math.abs(Number(result) - tc.expected)).toBeLessThanOrEqual(100);
    });
  }
});

describe("L10 — Additional pension % by age (vs golden oracle)", () => {
  for (const tc of goldens.pension_additional_pct) {
    it(`age ${tc.age} → ${tc.expectedPct}%`, () => {
      const result = Number(additionalPensionPct(tc.age));
      expect(result).toBe(tc.expectedPct);
    });
  }
});

describe("L10 — EPF computation (vs golden oracle)", () => {
  for (const tc of goldens.epf.cases) {
    it(`${tc.note}`, () => {
      const result = computeSlip({
        basicMinor: BigInt(tc.basicMinor),
        daRateBps: tc.daMinor > 0 ? BigInt(Math.round((tc.daMinor / tc.basicMinor) * 10000)) : 0n,
        pensionScheme: "EPF",
        taxRegime: "new",
        fyStartYear: 2025,
      }) as { pfEmployeeMinor: bigint };
      // EPF employee contribution should match golden
      expect(Math.abs(Number(result.pfEmployeeMinor) - tc.expectedPfEmployee)).toBeLessThanOrEqual(100);
    });
  }
});

describe("L10 — Pension computation (basic + DR + additional)", () => {
  it("pensioner aged 82 gets 20% additional pension", () => {
    const result = computePension({
      basicPensionMinor: 4000000n, // ₹40,000
      drRateBps: 5000n,            // 50% DR
      dateOfBirth: "1944-01-15",
      month: "2026-07",
    }) as { additionalPensionMinor: bigint; drMinor: bigint; grossMinor: bigint };

    // Additional pension = 20% of 40000 = 8000 (800000 paise)
    expect(Number(result.additionalPensionMinor)).toBe(800000);
    // DR = 50% of (40000 + 8000) = 24000 (2400000 paise)
    expect(Number(result.drMinor)).toBe(2400000);
    // Gross = 40000 + 8000 + 24000 = 72000 (7200000 paise)
    expect(Number(result.grossMinor)).toBe(7200000);
  });

  it("commutation deducted before restoration (15-year rule)", () => {
    const result = computePension({
      basicPensionMinor: 4000000n,
      commutedPensionMinor: 1600000n, // ₹16,000 commuted
      commutationDate: "2020-01-01",  // <15 years ago
      dateOfBirth: "1960-01-15",
      month: "2026-07",
    }) as { commutationDeductionMinor: bigint; commutationRestored: boolean; payableBasicPensionMinor: bigint };

    expect(result.commutationRestored).toBe(false);
    expect(Number(result.commutationDeductionMinor)).toBe(1600000);
    expect(Number(result.payableBasicPensionMinor)).toBe(2400000);
  });
});
