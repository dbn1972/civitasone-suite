import { describe, it, expect } from "vitest";
import { computeLoanStats } from "./loanStats";

describe("computeLoanStats (GAP-PAYROLL-LOANS-03)", () => {
  it("counts only disbursed/repaying as active and sums EMI/outstanding over active loans only", () => {
    const stats = computeLoanStats([
      { status: "applied", outstandingMinor: "500000", emiMinor: "50000" },
      { status: "disbursed", outstandingMinor: "300000", emiMinor: "25000" },
      { status: "closed", outstandingMinor: "0", emiMinor: "40000" },
    ]);
    expect(stats).toEqual({ total: 3, active: 1, pending: 1, outstandingMinor: 300000n, monthlyEmiMinor: 25000n });
  });

  it("treats repaying as active, approved as pending, rejected as neither", () => {
    const stats = computeLoanStats([
      { status: "repaying", outstandingMinor: 1000, emiMinor: 100 },
      { status: "approved", outstandingMinor: 2000, emiMinor: 200 },
      { status: "rejected", outstandingMinor: 3000, emiMinor: 300 },
    ]);
    expect(stats.active).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.monthlyEmiMinor).toBe(100n);
  });

  it("sums beyond Number.MAX_SAFE_INTEGER exactly (bigint)", () => {
    const big = "9007199254740993"; // 2^53 + 1
    const stats = computeLoanStats([
      { status: "disbursed", outstandingMinor: big, emiMinor: "1" },
      { status: "disbursed", outstandingMinor: "1", emiMinor: "1" },
    ]);
    expect(stats.outstandingMinor).toBe(9007199254740994n);
  });

  it("ignores malformed amounts instead of producing NaN", () => {
    const stats = computeLoanStats([{ status: "disbursed", outstandingMinor: "abc", emiMinor: "" }]);
    expect(stats.outstandingMinor).toBe(0n);
    expect(stats.monthlyEmiMinor).toBe(0n);
  });
});
