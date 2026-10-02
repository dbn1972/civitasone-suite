import { describe, it, expect } from "vitest";
import { sumMinor } from "./formatters";

// GAP-FINANCE-PFMS-04
describe("sumMinor", () => {
  it("sums valid values and counts invalid ones instead of throwing", () => {
    expect(sumMinor(["100", "abc", "250"])).toEqual({ total: 350n, invalid: 1 });
  });
  it("treats a fractional string as invalid (BigInt('12.50') would throw)", () => {
    expect(sumMinor(["12.50", "100"])).toEqual({ total: 100n, invalid: 1 });
  });
  it("treats null / undefined / empty as zero, not corrupt", () => {
    expect(sumMinor(["100", null, undefined, ""])).toEqual({ total: 100n, invalid: 0 });
  });
  it("accepts numbers, bigints and negatives; rejects unsafe numbers", () => {
    expect(sumMinor([5, 10n, "-3"])).toEqual({ total: 12n, invalid: 0 });
    expect(sumMinor([Number.MAX_SAFE_INTEGER + 10, 1.5])).toEqual({ total: 0n, invalid: 2 });
  });
  it("is exact above 2^53 (no float accumulation)", () => {
    expect(sumMinor(["9007199254740993", "1"]).total).toBe(9007199254740994n);
  });
});
