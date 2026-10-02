import { describe, it, expect } from "vitest";
import type { BudgetSummary } from "@civitasone/types";
import {
  isMaterialVariance, MATERIAL_VARIANCE_BPS, parseMinor, previousFinancialYear, priorYearBeByHead, varianceBps,
} from "./budgetColumns";

const row = (o: Partial<BudgetSummary>): BudgetSummary => ({
  id: "x", majorHead: "2202", subHead: "Edu", sanctionedAmount: "0", releasedAmount: "0", expenditure: "0",
  balance: "0", beMinor: "0", reMinor: "0", status: "approved", financialYear: "2026-27", ...o,
});

describe("budget column helpers", () => {
  it("parseMinor is strict and exact (never a fabricated 0)", () => {
    expect(parseMinor("900719925474099300")).toBe(900719925474099300n);
    expect(parseMinor(10000000)).toBe(10000000n);
    for (const bad of [null, undefined, "", "abc", "1.5", 1.5]) expect(parseMinor(bad)).toBeNull();
  });
  it("previousFinancialYear", () => {
    expect(previousFinancialYear("2026-27")).toBe("2025-26");
    expect(previousFinancialYear("2000-01")).toBe("1999-00");
    expect(previousFinancialYear("bad")).toBeNull();
  });
  it("priorYearBeByHead sums last FY's BE per head only (not sanctioned/released)", () => {
    const all = [
      row({ financialYear: "2025-26", beMinor: "700", sanctionedAmount: "999", releasedAmount: "888" }),
      row({ financialYear: "2025-26", beMinor: "300" }),
      row({ financialYear: "2024-25", beMinor: "5" }),
      row({ financialYear: "2026-27", beMinor: "1" }),
      row({ financialYear: "2025-26", majorHead: "9999", beMinor: "42" }),
    ];
    expect(priorYearBeByHead(all, "2026-27")).toEqual({ "2202|Edu": "1000", "9999|Edu": "42" });
  });
  it("varianceBps is exact BigInt maths; undefined against a missing/zero BE", () => {
    expect(varianceBps(900719925474099300n, 900719925474099400n)).toBe(0n); // sub-bp change
    expect(varianceBps(10000000n, 12000000n)).toBe(2000n);
    expect(varianceBps(10000000n, 9000000n)).toBe(-1000n);
    expect(varianceBps(null, 5n)).toBeNull();
    expect(varianceBps(0n, 5n)).toBeNull();
  });
  it("isMaterialVariance flags >= 10% either way, not 5%", () => {
    expect(MATERIAL_VARIANCE_BPS).toBe(1000n);
    expect(isMaterialVariance(1200n)).toBe(true);
    expect(isMaterialVariance(-1000n)).toBe(true);
    expect(isMaterialVariance(500n)).toBe(false);
    expect(isMaterialVariance(null)).toBe(false);
  });
});
