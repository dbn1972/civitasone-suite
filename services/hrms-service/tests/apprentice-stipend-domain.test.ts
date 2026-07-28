/**
 * Apprentice stipend engine — attendance pro-rating + NAPS reimbursement (capped).
 */
import { describe, it, expect } from "vitest";
import { computeStipend, prorate, applyBps } from "../src/modules/apprentice-stipend/domain.js";

describe("prorate", () => {
  it("returns the full stipend on full attendance", () => {
    expect(prorate(1_000_000n, 26, 26)).toBe(1_000_000n);
    expect(prorate(1_000_000n, 30, 26)).toBe(1_000_000n); // capped at full
  });
  it("pro-rates half up for partial attendance", () => {
    expect(prorate(1_000_000n, 13, 26)).toBe(500_000n);   // exactly half
    expect(prorate(1_000_000n, 20, 26)).toBe(769_231n);   // 769230.7 -> 769231
  });
  it("zeroes on no attendance / bad inputs", () => {
    expect(prorate(1_000_000n, 0, 26)).toBe(0n);
    expect(prorate(1_000_000n, 10, 0)).toBe(0n);
  });
});

describe("computeStipend", () => {
  const cap = 150_000n;     // ₹1,500
  const pct = 2500;         // 25%

  it("full month: 25% reimbursement below cap", () => {
    // ₹5,000 stipend -> 25% = ₹1,250 (< ₹1,500 cap)
    const s = computeStipend({ monthlyStipendMinor: 500_000n, workingDays: 26, daysPresent: 26, napsReimbPctBps: pct, napsReimbCapMinor: cap });
    expect(s.grossStipendMinor).toBe(500_000n);
    expect(s.napsReimbMinor).toBe(125_000n);       // ₹1,250
    expect(s.employerCostMinor).toBe(375_000n);    // ₹3,750
  });

  it("caps the NAPS reimbursement at ₹1,500", () => {
    // ₹9,000 stipend -> 25% = ₹2,250 -> capped to ₹1,500
    const s = computeStipend({ monthlyStipendMinor: 900_000n, workingDays: 26, daysPresent: 26, napsReimbPctBps: pct, napsReimbCapMinor: cap });
    expect(s.napsReimbMinor).toBe(150_000n);        // capped
    expect(s.employerCostMinor).toBe(750_000n);     // 9,000 - 1,500
  });

  it("pro-rates the stipend AND the reimbursement for partial attendance", () => {
    // ₹8,000 monthly, 13/26 days -> gross ₹4,000; 25% = ₹1,000 (< cap)
    const s = computeStipend({ monthlyStipendMinor: 800_000n, workingDays: 26, daysPresent: 13, napsReimbPctBps: pct, napsReimbCapMinor: cap });
    expect(s.grossStipendMinor).toBe(400_000n);
    expect(s.napsReimbMinor).toBe(100_000n);        // ₹1,000
    expect(s.employerCostMinor).toBe(300_000n);
  });

  it("zero attendance -> zero everything", () => {
    const s = computeStipend({ monthlyStipendMinor: 800_000n, workingDays: 26, daysPresent: 0, napsReimbPctBps: pct, napsReimbCapMinor: cap });
    expect(s.grossStipendMinor).toBe(0n);
    expect(s.napsReimbMinor).toBe(0n);
    expect(s.employerCostMinor).toBe(0n);
  });
});

describe("applyBps", () => {
  it("rounds half up", () => {
    expect(applyBps(500_000n, 2500)).toBe(125_000n);
  });
});
