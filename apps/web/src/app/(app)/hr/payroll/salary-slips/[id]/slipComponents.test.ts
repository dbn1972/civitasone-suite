import { describe, it, expect } from "vitest";
import { breakdownSlip } from "./slipComponents";

const c = (code: string, type: string, amountMinor: number) => ({ code, name: code, type, amountMinor });

describe("breakdownSlip (GAP-PAYROLL-SALARY-SLIPS-DETAIL-03)", () => {
  it("keeps non earning/deduction types in 'other' instead of dropping them", () => {
    const b = breakdownSlip([c("BASIC", "earning", 50000), c("PF", "deduction", 6000), c("ER_PF", "employer_contribution", 6000)], 50000, 6000);
    expect(b.other.map((x) => x.code)).toEqual(["ER_PF"]);
    expect(b.earnings).toHaveLength(1);
    expect(b.earningsMatchGross).toBe(true);
    expect(b.deductionsMatchTotal).toBe(true);
  });
  it("flags lines that do not add up to the slip totals", () => {
    const b = breakdownSlip([c("BASIC", "earning", 50000), c("PF", "deduction", 6000)], 60000, 7000);
    expect(b.earningsMatchGross).toBe(false);
    expect(b.deductionsMatchTotal).toBe(false);
  });
  it("sums exactly in paise", () => {
    const b = breakdownSlip([c("A", "earning", 1), c("B", "earning", 2)], 3, 0);
    expect(b.earningsSumMinor).toBe(3n);
    expect(b.earningsMatchGross).toBe(true);
  });
});
