import { describe, it, expect } from "vitest";
import { formatSignedMoney, formatSignedPercent, percentChange, sumMinor, toMinorBigInt } from "./money";

describe("sumMinor (GAP-PAYROLL-REGISTER-01)", () => {
  it("sums integer-string paise exactly beyond 2^53", () => {
    expect(sumMinor(["9007199254740993", "9007199254740993"])).toBe(18014398509481986n);
    // Number() would have lost the odd paisa:
    expect(BigInt(Number("9007199254740993") + Number("9007199254740993"))).not.toBe(18014398509481986n);
  });
  it("returns null (unknown) when any value is missing or fractional", () => {
    expect(sumMinor(["100", null])).toBeNull();
    expect(sumMinor(["100", "1.5"])).toBeNull();
    expect(toMinorBigInt(1.5)).toBeNull();
  });
});

describe("formatSignedMoney (GAP-PAYROLL-COMPARISON-04)", () => {
  it("uses a real minus sign and a plus for increases", () => {
    expect(formatSignedMoney(-15000n)).toBe("−₹150.00");
    expect(formatSignedMoney(15000n)).toBe("+₹150.00");
    expect(formatSignedMoney(0n)).toBe("₹0.00");
    expect(formatSignedMoney(null)).toBe("—");
  });
});

describe("percentChange / formatSignedPercent", () => {
  it("is unknown when the base is zero", () => {
    expect(percentChange(0n, 100n)).toBeNull();
    expect(formatSignedPercent(null)).toBe("—");
  });
  it("formats a signed one-decimal percentage", () => {
    expect(formatSignedPercent(percentChange(200n, 250n))).toBe("+25.0%");
    expect(formatSignedPercent(percentChange(200n, 150n))).toBe("−25.0%");
  });
});
