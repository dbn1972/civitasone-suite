import { describe, it, expect } from "vitest";
import { minorToDecimalString } from "./money";

// GAP-FINANCE-BUDGET-FUND-RELEASES-04
describe("minorToDecimalString", () => {
  it("renders paise exactly as a plain rupees decimal", () => {
    expect(minorToDecimalString("125000000")).toBe("1250000.00");
    expect(minorToDecimalString("123456")).toBe("1234.56");
    expect(minorToDecimalString("5")).toBe("0.05");
    expect(minorToDecimalString("0")).toBe("0.00");
    expect(minorToDecimalString(-5n)).toBe("-0.05");
  });
  it("is exact above 2^53 paise", () => {
    expect(minorToDecimalString("9007199254740993")).toBe("90071992547409.93");
  });
  it("returns null for anything that is not an integer", () => {
    for (const bad of [null, undefined, "", "abc", "1.5", "1e5", Number.NaN, 1.5]) {
      expect(minorToDecimalString(bad as never)).toBeNull();
    }
  });
});
