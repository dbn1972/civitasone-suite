/**
 * Payroll domain coverage tests — computeSlip, gratuity, status transitions.
 */
import { describe, it, expect } from "vitest";
import {
  computeSlip, roundRupee, hraSlabPct, assertRunStatusTransition,
  computeGratuity, DomainError,
  type SlipInput,
} from "../src/modules/payroll/domain.js";

describe("payroll/domain — roundRupee()", () => {
  it("rounds 150 paise to 200", () => { expect(roundRupee(150n)).toBe(200n); });
  it("rounds 149 paise to 100", () => { expect(roundRupee(149n)).toBe(100n); });
  it("rounds 0 to 0", () => { expect(roundRupee(0n)).toBe(0n); });
  it("rounds negative", () => { expect(roundRupee(-150n)).toBe(-200n); });
});

describe("payroll/domain — hraSlabPct()", () => {
  it("X city base (DA<50%) = 24%", () => { expect(hraSlabPct("X", 4000n)).toBe(24n); });
  it("X city DA>=50% = 27%", () => { expect(hraSlabPct("X", 5000n)).toBe(27n); });
  it("X city DA>=100% = 30%", () => { expect(hraSlabPct("X", 10000n)).toBe(30n); });
  it("Y city base = 16%", () => { expect(hraSlabPct("Y", 0n)).toBe(16n); });
  it("Z city base = 8%", () => { expect(hraSlabPct("Z", 0n)).toBe(8n); });
});

describe("payroll/domain — computeSlip() EPF", () => {
  const base: SlipInput = {
    basicMinor: 5600000n,
    daRateBps: 5000n,
    cityClass: "X",
    pensionScheme: "EPF",
    taxRegime: "new",
    fyStartYear: 2025,
  };

  it("produces earnings with BASIC, DA, HRA", () => {
    const r = computeSlip(base);
    expect(r.earnings.some(e => e.code === "BASIC")).toBe(true);
    expect(r.earnings.some(e => e.code === "DA")).toBe(true);
    expect(r.earnings.some(e => e.code === "HRA")).toBe(true);
  });

  it("gross is sum of all earnings", () => {
    const r = computeSlip(base);
    const sum = r.earnings.reduce((s, e) => s + e.amountMinor, 0n);
    expect(r.grossMinor).toBe(sum);
  });

  it("net = gross - total deductions", () => {
    const r = computeSlip(base);
    expect(r.netPayMinor).toBe(r.grossMinor - r.totalDeductionsMinor);
  });

  it("EPF employee PF is capped at 12% of ₹15K", () => {
    const r = computeSlip(base);
    expect(r.pfEmployeeMinor).toBe(180000n);
  });

  it("ESI NOT deducted when gross > ₹21K", () => {
    const r = computeSlip(base);
    expect(r.esiMinor).toBe(0n);
  });

  it("ESI deducted when gross <= ₹21K", () => {
    const r = computeSlip({ ...base, basicMinor: 1000000n, daRateBps: 0n });
    expect(r.esiMinor).toBeGreaterThan(0n);
  });
});

describe("payroll/domain — computeSlip() GPF", () => {
  it("GPF = 10% of basic+DA", () => {
    const r = computeSlip({ basicMinor: 5000000n, daRateBps: 5000n, pensionScheme: "GPF", taxRegime: "new", fyStartYear: 2025 });
    expect(r.gpfMinor).toBe(750000n);
  });
});

describe("payroll/domain — computeSlip() NPS", () => {
  it("NPS employee = 10%, employer = 14%", () => {
    const r = computeSlip({ basicMinor: 5000000n, daRateBps: 5000n, pensionScheme: "NPS", taxRegime: "new", fyStartYear: 2025 });
    expect(r.npsEmployeeMinor).toBe(750000n);
    expect(r.npsEmployerMinor).toBe(1050000n);
  });
});

describe("payroll/domain — computeSlip() with rawComponents", () => {
  it("adds percentage-based earning", () => {
    const r = computeSlip({
      basicMinor: 5000000n, pensionScheme: "EPF", taxRegime: "new", fyStartYear: 2025,
      rawComponents: [{ code: "TA", name: "Transport", type: "earning", pctOfBasic: 10, fixedMinor: 0n }],
    });
    expect(r.earnings.some(e => e.code === "TA")).toBe(true);
  });

  it("adds fixed deduction", () => {
    const r = computeSlip({
      basicMinor: 5000000n, pensionScheme: "EPF", taxRegime: "new", fyStartYear: 2025,
      rawComponents: [{ code: "CANTEEN", name: "Canteen", type: "deduction", fixedMinor: 50000n }],
    });
    expect(r.deductions.some(d => d.code === "CANTEEN")).toBe(true);
  });
});

describe("payroll/domain — assertRunStatusTransition()", () => {
  it("allows draft → processing", () => { expect(() => assertRunStatusTransition("draft", "processing")).not.toThrow(); });
  it("allows processing → approved", () => { expect(() => assertRunStatusTransition("processing", "approved")).not.toThrow(); });
  it("allows processing → failed", () => { expect(() => assertRunStatusTransition("processing", "failed")).not.toThrow(); });
  it("allows approved → disbursed", () => { expect(() => assertRunStatusTransition("approved", "disbursed")).not.toThrow(); });
  it("allows failed → draft", () => { expect(() => assertRunStatusTransition("failed", "draft")).not.toThrow(); });
  it("blocks draft → approved", () => { expect(() => assertRunStatusTransition("draft", "approved")).toThrow(DomainError); });
  it("blocks disbursed → draft", () => { expect(() => assertRunStatusTransition("disbursed", "draft")).toThrow(DomainError); });
});

describe("payroll/domain — computeGratuity()", () => {
  it("computes for 20 years service", () => {
    const g = computeGratuity(20, 5600000n, 2800000n);
    expect(g).toBeGreaterThan(0n);
  });

  it("caps at 20 lakh", () => {
    const g = computeGratuity(40, 20000000n, 10000000n);
    expect(g).toBeLessThanOrEqual(200000000n);
  });

  it("returns 0 for < 5 years", () => {
    expect(computeGratuity(4, 5000000n)).toBe(0n);
  });
});
