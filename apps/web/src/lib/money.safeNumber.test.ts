import { describe, it, expect } from "vitest";
import { minorToSafeNumber } from "./money";

describe("minorToSafeNumber", () => {
  it("converts an in-range paise digit string exactly", () => {
    expect(minorToSafeNumber("15050")).toBe(15050);
    expect(minorToSafeNumber("0")).toBe(0);
    expect(minorToSafeNumber(123n)).toBe(123);
  });

  it("accepts exactly Number.MAX_SAFE_INTEGER", () => {
    expect(minorToSafeNumber(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects one paisa above Number.MAX_SAFE_INTEGER instead of silently altering it", () => {
    expect(minorToSafeNumber("9007199254740992")).toBeNull();
    // Number("12345678901234567") === 12345678901234568 would post a different amount.
    expect(minorToSafeNumber("12345678901234567")).toBeNull();
    expect(minorToSafeNumber(12345678901234567n)).toBeNull();
  });

  it("rejects null, undefined, empty, signed and non-digit input", () => {
    for (const bad of [null, undefined, "", "-5", "1.5", "1e3", "abc", " 5"]) {
      expect(minorToSafeNumber(bad as never)).toBeNull();
    }
    expect(minorToSafeNumber(-1n)).toBeNull();
  });
});
