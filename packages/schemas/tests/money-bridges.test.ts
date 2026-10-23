import { describe, it, expect } from "vitest";
import { minorToSafeNumber, minorToMajorString, minorToMajorNumber } from "../src/money.js";

describe("minorToSafeNumber", () => {
  it("returns the exact number for safe amounts", () => {
    expect(minorToSafeNumber(123456n)).toBe(123456);
    expect(minorToSafeNumber("-42")).toBe(-42);
    expect(minorToSafeNumber(0)).toBe(0);
  });
  it("refuses amounts above the safe-integer range instead of rounding", () => {
    expect(() => minorToSafeNumber(9007199254740993n)).toThrow(RangeError);
    expect(() => minorToSafeNumber(-9007199254740993n)).toThrow(RangeError);
  });
  it("rejects malformed input", () => {
    expect(() => minorToSafeNumber("12.5")).toThrow(RangeError);
    expect(() => minorToSafeNumber(1.5)).toThrow(RangeError);
  });
});

describe("minorToMajorString / minorToMajorNumber", () => {
  it("formats exactly with two decimals", () => {
    expect(minorToMajorString(123450n)).toBe("1234.50");
    expect(minorToMajorString(5n)).toBe("0.05");
    expect(minorToMajorString(-5n)).toBe("-0.05");
    expect(minorToMajorString(0n)).toBe("0.00");
  });
  it("stays exact above 2^53", () => {
    expect(minorToMajorString(9007199254740993n)).toBe("90071992547409.93");
  });
  it("supports a custom scale", () => {
    expect(minorToMajorString(1234n, 0)).toBe("1234");
    expect(minorToMajorString(1234n, 3)).toBe("1.234");
  });
  it("number form equals the float division for safe amounts", () => {
    for (const v of [0n, 1n, 99n, 100n, 12345n, 987654321n]) {
      expect(minorToMajorNumber(v)).toBe(Number(v) / 100);
    }
  });
});
