/**
 * Engagement-policy payroll gates (DIC Phase 2) — pure domain tests.
 *   - isPayrollEligible excludes consultant/third-party/apprentice pay routes
 *   - statutory gates suppress PF / ESI / NPS per engagement policy
 *   - omitting the gates preserves pre-engagement behaviour (backward compatible)
 */
import { describe, it, expect } from "vitest";
import { computeSlip, isPayrollEligible } from "../src/modules/payroll/domain.js";

const base = { basicMinor: 1000000n, daRateBps: 0n, cityClass: "X" as const, ptMinor: 0n };

describe("isPayrollEligible", () => {
  it("only the 'payroll' route is salary-eligible", () => {
    expect(isPayrollEligible({ paymentRoute: "payroll" })).toBe(true);
    for (const r of ["invoice", "agency", "stipend", "none"]) {
      expect(isPayrollEligible({ paymentRoute: r })).toBe(false);
    }
  });
  it("eligibleForPayroll:false excludes regardless of route", () => {
    expect(isPayrollEligible({ paymentRoute: "payroll", eligibleForPayroll: false })).toBe(false);
  });
  it("defaults to eligible when unset (backward compatible)", () => {
    expect(isPayrollEligible({})).toBe(true);
    expect(isPayrollEligible({ paymentRoute: "PAYROLL" })).toBe(true); // case-insensitive
  });
});

describe("computeSlip statutory gating", () => {
  it("EPF employee: PF deducted by default", () => {
    const r = computeSlip({ ...base, pensionScheme: "EPF" });
    expect(r.pfEmployeeMinor).toBeGreaterThan(0n);
  });
  it("statutoryPf=false suppresses EPF (employee + employer)", () => {
    const r = computeSlip({ ...base, pensionScheme: "EPF", statutoryPf: false });
    expect(r.pfEmployeeMinor).toBe(0n);
    expect(r.pfEmployerMinor).toBe(0n);
  });
  it("NPS deducted by default; statutoryNps=false suppresses it", () => {
    const on = computeSlip({ ...base, pensionScheme: "NPS" });
    expect(on.npsEmployeeMinor).toBeGreaterThan(0n);
    const off = computeSlip({ ...base, pensionScheme: "NPS", statutoryNps: false });
    expect(off.npsEmployeeMinor).toBe(0n);
    expect(off.npsEmployerMinor).toBe(0n);
  });
  it("statutoryEsi=false suppresses ESI even under the wage cap", () => {
    const on = computeSlip({ ...base, pensionScheme: "EPF" });
    expect(on.esiMinor).toBeGreaterThan(0n); // low wage → under ESI cap
    const off = computeSlip({ ...base, pensionScheme: "EPF", statutoryEsi: false });
    expect(off.esiMinor).toBe(0n);
    expect(off.esiEmployerMinor).toBe(0n);
  });
  it("omitting the gates preserves pre-engagement behaviour", () => {
    const a = computeSlip({ ...base, pensionScheme: "EPF" });
    const b = computeSlip({ ...base, pensionScheme: "EPF", statutoryPf: true, statutoryEsi: true, statutoryNps: true });
    expect(a.pfEmployeeMinor).toBe(b.pfEmployeeMinor);
    expect(a.esiMinor).toBe(b.esiMinor);
  });
});
