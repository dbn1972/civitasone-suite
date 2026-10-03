import { describe, it, expect } from "vitest";
import { summariseDebt } from "./debtStats";

describe("summariseDebt (GAP-FINANCE-DEBT-02)", () => {
  it("totals equal the sum of the rows, in bigint paise", () => {
    const s = summariseDebt([
      { status: "active", amountMinor: "100000000000000000000" },
      { status: "Closed", amountMinor: "250" },
      { status: "active", amountMinor: "bad" },
    ]);
    expect(s).toEqual({ total: 3, active: 2, closed: 1, totalMinor: 100000000000000000250n, outstandingMinor: 0n, hasOutstanding: false, allInr: true });
  });
  it("an empty list is a genuine zero", () => {
    expect(summariseDebt([])).toEqual({ total: 0, active: 0, closed: 0, totalMinor: 0n, outstandingMinor: 0n, hasOutstanding: false, allInr: true });
  });

  // GAP-FINANCE-DEBT-01
  it("outstanding principal sums only loans that carry a repayment position; none -> hasOutstanding false (a dash, not zero)", () => {
    const s = summariseDebt([
      { status: "active", amountMinor: "1000", outstandingMinor: "600" },
      { status: "active", amountMinor: "2000", outstandingMinor: "9007199254740993" },
      { status: "active", amountMinor: "3000", outstandingMinor: null },
    ]);
    expect(s.outstandingMinor).toBe(9007199254741593n);
    expect(s.hasOutstanding).toBe(true);
    expect(summariseDebt([{ status: "active", amountMinor: "3000" }]).hasOutstanding).toBe(false);
  });

  it("allInr is false as soon as one row is not INR (review D4)", () => {
    expect(summariseDebt([{ status: "active", amountMinor: "1", currency: "INR" }, { status: "active", amountMinor: "1", currency: "USD" }]).allInr).toBe(false);
    expect(summariseDebt([{ status: "active", amountMinor: "1", currency: "inr" }]).allInr).toBe(true);
    expect(summariseDebt([]).allInr).toBe(true);
  });
});
