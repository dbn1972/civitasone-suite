import { describe, it, expect } from "vitest";
import { parseMinor, minorString, zMoneyMinorString, zMoneyMinor } from "../src/money.js";

describe("money codec (R7)", () => {
  it("parseMinor accepts bigint, safe number, and decimal string", () => {
    expect(parseMinor(12345n)).toBe(12345n);
    expect(parseMinor(12345)).toBe(12345n);
    expect(parseMinor("12345")).toBe(12345n);
    expect(parseMinor("-500")).toBe(-500n);
  });

  it("parseMinor preserves precision above 2^53 from a string", () => {
    const big = "900700000000000001"; // ~₹9,007 cr + 1 paisa, beyond 2^53
    expect(parseMinor(big)).toBe(900700000000000001n);
  });

  it("parseMinor rejects an unsafe number (already lossy)", () => {
    expect(() => parseMinor(Number.MAX_SAFE_INTEGER + 2)).toThrowError(/safe-integer/);
  });

  it("parseMinor rejects non-integers and junk strings", () => {
    expect(() => parseMinor(12.5)).toThrowError(/integer/);
    expect(() => parseMinor("12.5")).toThrowError(/base-10/);
    expect(() => parseMinor("abc")).toThrowError(/base-10/);
  });

  it("minorString round-trips exactly for large values", () => {
    expect(minorString(900700000000000001n)).toBe("900700000000000001");
    expect(minorString(0n)).toBe("0");
  });

  it("zMoneyMinorString normalises number or string to a canonical string", () => {
    expect(zMoneyMinorString.parse(500)).toBe("500");
    expect(zMoneyMinorString.parse("500")).toBe("500");
  });

  it("zMoneyMinor decodes to a bigint", () => {
    expect(zMoneyMinor.parse("900700000000000001")).toBe(900700000000000001n);
    expect(zMoneyMinor.parse(42)).toBe(42n);
  });
});
