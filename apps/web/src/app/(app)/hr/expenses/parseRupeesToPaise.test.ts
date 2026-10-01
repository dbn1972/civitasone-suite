import { describe, it, expect } from "vitest";
import { parseRupeesToPaise } from "./parseRupeesToPaise";

describe("parseRupeesToPaise — GAP-HR-EXPENSES-02 no-float-drift money parsing", () => {
  it("parses whole rupees", () => {
    expect(parseRupeesToPaise("0")).toBe(0);
    expect(parseRupeesToPaise("1")).toBe(100);
    expect(parseRupeesToPaise("450")).toBe(45000);
  });

  it("parses exact paise, including values that are classic floating-point trouble spots", () => {
    expect(parseRupeesToPaise("0.01")).toBe(1);
    expect(parseRupeesToPaise("0.1")).toBe(10);
    expect(parseRupeesToPaise("0.2")).toBe(20);
    expect(parseRupeesToPaise("0.3")).toBe(30);
    expect(parseRupeesToPaise("19.9")).toBe(1990);
    expect(parseRupeesToPaise("1234.56")).toBe(123456);
    expect(parseRupeesToPaise("99999.99")).toBe(9999999);
  });

  it("pads a single decimal digit (treats '.5' as 50 paise, not 5)", () => {
    expect(parseRupeesToPaise("1.5")).toBe(150);
    expect(parseRupeesToPaise("1.05")).toBe(105);
  });

  it("never performs a floating-point multiplication on the rupee value -- unlike `Math.round(Number(x) * 100)`, parseRupeesToPaise computes the integer result via parseInt on the split string parts only", () => {
    // Documented, verified fact this module's doc comment relies on: for a
    // plain 2-decimal rupee string, `Number(x) * 100` is not always an exact
    // integer (IEEE-754 representation, not a rounding bug) -- Math.round
    // happens to compensate for it, but only incidentally.
    expect(Number("19.9") * 100).not.toBe(1990);
    expect(Math.round(Number("19.9") * 100)).toBe(1990); // naive approach still correct here, see this file's import's doc comment
    // parseRupeesToPaise never multiplies a float at all, so there is no
    // representation noise to compensate for in the first place.
    expect(parseRupeesToPaise("19.9")).toBe(1990);
  });

  it("rejects malformed input that Number() would silently misparse, instead of returning NaN or a fabricated amount", () => {
    expect(parseRupeesToPaise("1e5")).toBeNull(); // Number("1e5") === 100000 -- silently "valid" under a naive parser
    expect(parseRupeesToPaise("1,234.56")).toBeNull(); // Number(...) === NaN under a naive parser
    expect(parseRupeesToPaise("Infinity")).toBeNull();
    expect(parseRupeesToPaise("0x1F")).toBeNull();
    expect(parseRupeesToPaise("")).toBeNull();
    expect(parseRupeesToPaise("   ")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
  });

  it("rejects negative amounts, a leading '+', and more than 2 decimal places", () => {
    expect(parseRupeesToPaise("-5")).toBeNull();
    expect(parseRupeesToPaise("+5")).toBeNull();
    expect(parseRupeesToPaise("5.123")).toBeNull();
    expect(parseRupeesToPaise(".5")).toBeNull();
  });

  it("safe-integer-guards an unrealistically large amount instead of silently overflowing", () => {
    expect(parseRupeesToPaise("99999999999999.99")).toBeNull();
  });
});
