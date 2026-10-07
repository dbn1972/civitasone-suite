import { describe, it, expect } from "vitest";
import { sumMinor } from "./money";

/** GAP-WORKS-BILLING-WORKID-05: BigInt paise sum, no float accumulation. */
describe("sumMinor", () => {
  it("sums paise strings exactly beyond Number.MAX_SAFE_INTEGER", () => {
    expect(sumMinor(["9007199254740993", "1"])).toBe(9007199254740994n);
  });
  it("sums ordinary values", () => {
    expect(sumMinor(["100000", "50000"])).toBe(150000n);
  });
  it("skips empty/nullish/unparsable entries rather than crashing", () => {
    expect(sumMinor(["100000", "", null, undefined, "abc", "50000"])).toBe(150000n);
  });
  it("accepts bigint and number entries", () => {
    expect(sumMinor([100000n, 50000, "25000"])).toBe(175000n);
  });
  it("returns 0n for an empty list", () => {
    expect(sumMinor([])).toBe(0n);
  });
});
