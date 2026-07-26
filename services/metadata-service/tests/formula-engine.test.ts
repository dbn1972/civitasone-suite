/**
 * CAP-113 — calculation / formula engine (pure evaluator).
 */
import { describe, it, expect } from "vitest";
import { evaluateFormula, validateFormula, FormulaError } from "../src/modules/formula/domain.js";

describe("evaluateFormula — arithmetic", () => {
  it("adds, subtracts, multiplies, divides with precedence", () => {
    expect(evaluateFormula("2 + 3 * 4")).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4")).toBe(20);
    expect(evaluateFormula("10 - 4 - 3")).toBe(3);
    expect(evaluateFormula("20 / 4 / 5")).toBe(1);
    expect(evaluateFormula("10 % 3")).toBe(1);
  });

  it("resolves field references from context", () => {
    expect(evaluateFormula("qty * unit_price", { qty: 3, unit_price: 12.5 })).toBe(37.5);
    expect(evaluateFormula("qty * unit_price * (1 - discount)", { qty: 2, unit_price: 100, discount: 0.1 })).toBe(180);
  });

  it("treats missing fields as null → 0 in numeric context", () => {
    expect(evaluateFormula("a + b", { a: 5 })).toBe(5);
  });

  it("handles unary minus", () => {
    expect(evaluateFormula("-5 + 3")).toBe(-2);
    expect(evaluateFormula("-(2 + 3)")).toBe(-5);
  });

  it("throws on division by zero", () => {
    expect(() => evaluateFormula("10 / 0")).toThrow(FormulaError);
    expect(() => evaluateFormula("10 % 0")).toThrow(FormulaError);
  });
});

describe("evaluateFormula — functions", () => {
  it("ROUND with optional digits", () => {
    expect(evaluateFormula("ROUND(3.14159)")).toBe(3);
    expect(evaluateFormula("ROUND(3.14159, 2)")).toBe(3.14);
  });
  it("ABS, CEIL, FLOOR, SQRT, POW", () => {
    expect(evaluateFormula("ABS(-7)")).toBe(7);
    expect(evaluateFormula("CEIL(4.1)")).toBe(5);
    expect(evaluateFormula("FLOOR(4.9)")).toBe(4);
    expect(evaluateFormula("SQRT(16)")).toBe(4);
    expect(evaluateFormula("POW(2, 10)")).toBe(1024);
  });
  it("MIN/MAX variadic", () => {
    expect(evaluateFormula("MIN(3, 1, 2)")).toBe(1);
    expect(evaluateFormula("MAX(3, 9, 2)")).toBe(9);
  });
  it("string functions LEN/UPPER/LOWER/CONCAT", () => {
    expect(evaluateFormula("LEN(name)", { name: "hello" })).toBe(5);
    expect(evaluateFormula("UPPER(name)", { name: "abc" })).toBe("ABC");
    expect(evaluateFormula("LOWER(name)", { name: "ABC" })).toBe("abc");
    expect(evaluateFormula('CONCAT(first, " ", last)', { first: "Ada", last: "Lovelace" })).toBe("Ada Lovelace");
  });
  it("IF / COALESCE / ISBLANK", () => {
    expect(evaluateFormula('IF(amount > 100, "high", "low")', { amount: 150 })).toBe("high");
    expect(evaluateFormula('IF(amount > 100, "high", "low")', { amount: 50 })).toBe("low");
    expect(evaluateFormula("COALESCE(a, b, 0)", { a: null, b: 7 })).toBe(7);
    expect(evaluateFormula("ISBLANK(x)", { x: "" })).toBe(true);
    expect(evaluateFormula("ISBLANK(x)", { x: "v" })).toBe(false);
  });
  it("string concatenation via +", () => {
    expect(evaluateFormula('a + "-" + b', { a: "x", b: "y" })).toBe("x-y");
  });
  it("boolean logic AND/OR/NOT and comparisons", () => {
    expect(evaluateFormula("a > 1 AND b < 5", { a: 2, b: 3 })).toBe(true);
    expect(evaluateFormula("a > 1 OR b < 5", { a: 0, b: 9 })).toBe(false);
    expect(evaluateFormula("NOT (a == b)", { a: 1, b: 2 })).toBe(true);
    expect(evaluateFormula("a == b", { a: "x", b: "x" })).toBe(true);
    expect(evaluateFormula("a != b", { a: 1, b: 2 })).toBe(true);
  });
});

describe("evaluateFormula — safety / errors", () => {
  it("rejects unknown function", () => {
    expect(() => evaluateFormula("EVIL(1)")).toThrow(FormulaError);
  });
  it("rejects unterminated string", () => {
    expect(() => evaluateFormula('CONCAT("oops)')).toThrow(FormulaError);
  });
  it("rejects trailing garbage", () => {
    expect(() => evaluateFormula("1 + 2 )")).toThrow(FormulaError);
  });
  it("rejects unexpected characters", () => {
    expect(() => evaluateFormula("1 & 2")).toThrow(FormulaError);
  });
  it("rejects over-long expressions", () => {
    expect(() => evaluateFormula("1+".repeat(1100) + "1")).toThrow(FormulaError);
  });
  it("rejects deeply chained unary operators (depth cap)", () => {
    expect(() => evaluateFormula("-".repeat(200) + "1")).toThrow(/too deeply nested/);
  });
});

describe("validateFormula", () => {
  it("accepts well-formed expressions", () => {
    expect(validateFormula("qty * price").valid).toBe(true);
    expect(validateFormula("ROUND(a / b, 2)").valid).toBe(true); // data-dependent div-by-zero is not a syntax error
  });
  it("rejects malformed expressions with an error message", () => {
    const r = validateFormula("1 + + )");
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
