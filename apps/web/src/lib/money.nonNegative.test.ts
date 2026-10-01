import { describe, it, expect } from "vitest";
import { nonNegativeRupeesToMinorString } from "./money";

// GAP-PAYROLL-FNF-03: ComputeFnfForm's float-based Math.round(Number(v)*100)
// replaced by string parsing; zero must stay a valid amount (e.g. TDS YTD).
describe("nonNegativeRupeesToMinorString", () => {
  it("converts without float drift", () => {
    expect(nonNegativeRupeesToMinorString("1234.56")).toBe("123456");
    expect(nonNegativeRupeesToMinorString("0.1")).toBe("10");
    expect(nonNegativeRupeesToMinorString("0.29")).toBe("29");
    expect(nonNegativeRupeesToMinorString("1234567890123.45")).toBe("123456789012345");
  });
  it("allows zero", () => {
    expect(nonNegativeRupeesToMinorString("0")).toBe("0");
    expect(nonNegativeRupeesToMinorString("0.00")).toBe("0");
  });
  it("rejects more than 2 decimals instead of rounding", () => {
    expect(nonNegativeRupeesToMinorString("1.005")).toBeNull();
  });
  it("rejects negatives, junk and blanks", () => {
    expect(nonNegativeRupeesToMinorString("-5")).toBeNull();
    expect(nonNegativeRupeesToMinorString("1e5")).toBeNull();
    expect(nonNegativeRupeesToMinorString("abc")).toBeNull();
    expect(nonNegativeRupeesToMinorString("  ")).toBeNull();
  });
});
