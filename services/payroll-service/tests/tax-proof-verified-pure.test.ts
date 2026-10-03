/**
 * GAP-PAYROLL-TAX-DECLARATION-02: declared-vs-verified input selection (pure).
 */
import { describe, it, expect } from "vitest";
import {
  cutoffDate, proofCutoffPassed, isValidCutoffMd, verifiedDeductionFigures, hraAfterVerifiedRent, applyPlanToRow, NO_VERIFIED,
  DEFAULT_PROOF_CUTOFF_MD, type DeductionFigures,
} from "../src/modules/tax/verified-inputs.js";

const declared: DeductionFigures = { section80c: 150_000_00n, section80d: 25_000_00n, otherDeductions: 10_000_00n, rentPaidMinor: 240_000_00n, hraClaimed: 100_000_00n };

describe("proof cutoff dates", () => {
  it("defaults to 31 January of the FY (Jan-Mar fall in the second calendar year)", () => {
    expect(DEFAULT_PROOF_CUTOFF_MD).toBe("01-31");
    expect(cutoffDate("2025-26", "01-31")).toBe("2026-01-31");
    expect(cutoffDate("2025-26", "12-15")).toBe("2025-12-15");
    expect(cutoffDate("2025-26", "04-01")).toBe("2025-04-01");
    expect(cutoffDate("2025-26", "02-29")).toBe("2026-02-28"); // non-leap year clamps
    expect(cutoffDate("2023-24", "02-29")).toBe("2024-02-29");
    expect(cutoffDate("bad", "01-31")).toBeNull();
  });
  it("the cutoff day itself is still BEFORE the cutoff; the next day is after", () => {
    expect(proofCutoffPassed("2025-26", "01-31", "2026-01-31")).toBe(false);
    expect(proofCutoffPassed("2025-26", "01-31", "2026-02-01")).toBe(true);
    expect(proofCutoffPassed("2025-26", "01-31", "2025-06-01")).toBe(false);
    expect(proofCutoffPassed("2024-25", "01-31", "2026-10-03")).toBe(true); // a closed FY
  });
  it("validates MM-DD", () => {
    for (const ok of ["01-31", "02-29", "12-31", "04-30"]) expect(isValidCutoffMd(ok)).toBe(true);
    for (const bad of ["1-31", "13-01", "00-10", "04-31", "02-30", "01-32", "2026-01-31", ""]) expect(isValidCutoffMd(bad)).toBe(false);
  });
});

describe("verified figures", () => {
  it("counts only accepted amounts, capped at the declared amount", () => {
    const f = verifiedDeductionFigures(declared, { sec80c: 100_000_00n, sec80d: 40_000_00n, other: 0n, rent: 240_000_00n });
    expect(f.section80c).toBe(100_000_00n);
    expect(f.section80d).toBe(25_000_00n); // verified above declared -> declared
    expect(f.otherDeductions).toBe(0n);
    expect(f.rentPaidMinor).toBe(240_000_00n);
    expect(f.hraClaimed).toBe(100_000_00n); // fully verified rent keeps the exemption
  });
  it("unverified or rejected lines count as zero", () => {
    expect(verifiedDeductionFigures(declared, NO_VERIFIED)).toEqual({ section80c: 0n, section80d: 0n, otherDeductions: 0n, rentPaidMinor: 0n, hraClaimed: 0n });
  });
  it("statutory limits stay downstream: the engine still applies min(verified-or-declared, limit)", () => {
    const f = verifiedDeductionFigures({ ...declared, section80c: 300_000_00n }, { ...NO_VERIFIED, sec80c: 250_000_00n });
    expect(f.section80c).toBe(250_000_00n); // verified, below declared; the 1.5L cap is applied by the unchanged engine
  });
  it("HRA falls by the unverified rent, never below zero, never rises", () => {
    expect(hraAfterVerifiedRent(100_000_00n, 240_000_00n, 200_000_00n)).toBe(60_000_00n);
    expect(hraAfterVerifiedRent(100_000_00n, 240_000_00n, 0n)).toBe(0n);
    expect(hraAfterVerifiedRent(10_000_00n, 240_000_00n, 100_000_00n)).toBe(0n);
    expect(hraAfterVerifiedRent(100_000_00n, 240_000_00n, 999_000_00n)).toBe(100_000_00n);
  });
  it("applyPlanToRow leaves the row untouched before the cutoff and rewrites it after", () => {
    const row = { employeeId: "e1", ...declared, regime: "old" };
    expect(applyPlanToRow({ apply: false, verified: new Map() }, row)).toBe(row);
    const out = applyPlanToRow({ apply: true, verified: new Map([["e1", { sec80c: 1n, sec80d: 2n, other: 3n, rent: 0n }]]) }, row);
    expect(out).toMatchObject({ section80c: 1n, section80d: 2n, otherDeductions: 3n, rentPaidMinor: 0n, hraClaimed: 0n, regime: "old" });
    expect(applyPlanToRow({ apply: true, verified: new Map() }, row).section80c).toBe(0n);
  });
});
