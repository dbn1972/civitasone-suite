/**
 * Formula engine unit tests.
 * Covers arithmetic (+,-,*,/,%), field references, parentheses,
 * division by zero → null, missing field → null, multiple formulas, nested expressions.
 */
import { describe, it, expect } from "vitest";
import { evaluateFormulas, formatFormulaValue } from "../src/modules/templates/formula-engine.js";
import type { Formula } from "../src/modules/templates/formula-engine.js";

describe("evaluateFormulas", () => {
  describe("basic arithmetic", () => {
    it("evaluates addition", () => {
      const rows = [{ a: 10, b: 5 }];
      const formulas: Formula[] = [{ name: "sum", expression: "a + b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["sum"]).toBe(15);
    });

    it("evaluates subtraction", () => {
      const rows = [{ a: 10, b: 3 }];
      const formulas: Formula[] = [{ name: "diff", expression: "a - b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["diff"]).toBe(7);
    });

    it("evaluates multiplication", () => {
      const rows = [{ a: 4, b: 7 }];
      const formulas: Formula[] = [{ name: "product", expression: "a * b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["product"]).toBe(28);
    });

    it("evaluates division", () => {
      const rows = [{ a: 20, b: 4 }];
      const formulas: Formula[] = [{ name: "quotient", expression: "a / b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["quotient"]).toBe(5);
    });

    it("evaluates modulo", () => {
      const rows = [{ a: 17, b: 5 }];
      const formulas: Formula[] = [{ name: "remainder", expression: "a % b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["remainder"]).toBe(2);
    });
  });

  describe("field references", () => {
    it("resolves fields from row data", () => {
      const rows = [{ revenue: 1000, cost: 600 }];
      const formulas: Formula[] = [{ name: "margin", expression: "revenue - cost", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["margin"]).toBe(400);
    });

    it("handles multiple rows", () => {
      const rows = [
        { revenue: 1000, cost: 600 },
        { revenue: 2000, cost: 1500 },
      ];
      const formulas: Formula[] = [{ name: "margin", expression: "revenue - cost", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["margin"]).toBe(400);
      expect(result[1]!["margin"]).toBe(500);
    });

    it("handles underscore in field names", () => {
      const rows = [{ total_amount: 500, tax_rate: 18 }];
      const formulas: Formula[] = [{ name: "tax", expression: "total_amount * tax_rate / 100", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["tax"]).toBe(90);
    });
  });

  describe("parentheses", () => {
    it("respects parentheses for order of operations", () => {
      const rows = [{ a: 2, b: 3, c: 4 }];
      const formulas: Formula[] = [{ name: "result", expression: "(a + b) * c", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBe(20);
    });

    it("handles nested parentheses", () => {
      const rows = [{ a: 10, b: 2, c: 3, d: 1 }];
      const formulas: Formula[] = [{ name: "result", expression: "((a - b) * (c + d))", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBe(32);
    });

    it("handles complex formula: margin percentage", () => {
      const rows = [{ revenue: 1000, cost: 700 }];
      const formulas: Formula[] = [
        { name: "margin_pct", expression: "(revenue - cost) / revenue * 100", type: "percentage" },
      ];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["margin_pct"]).toBe(30);
    });
  });

  describe("division by zero → null", () => {
    it("returns null for direct division by zero", () => {
      const rows = [{ a: 10, b: 0 }];
      const formulas: Formula[] = [{ name: "result", expression: "a / b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBeNull();
    });

    it("returns null for modulo by zero", () => {
      const rows = [{ a: 10, b: 0 }];
      const formulas: Formula[] = [{ name: "result", expression: "a % b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBeNull();
    });

    it("returns null for division by expression that evaluates to zero", () => {
      const rows = [{ a: 10, b: 5, c: 5 }];
      const formulas: Formula[] = [{ name: "result", expression: "a / (b - c)", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBeNull();
    });
  });

  describe("missing field → null", () => {
    it("returns null when referenced field does not exist", () => {
      const rows = [{ a: 10 }];
      const formulas: Formula[] = [{ name: "result", expression: "a + missing", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBeNull();
    });

    it("returns null when field value is null", () => {
      const rows = [{ a: 10, b: null }];
      const formulas: Formula[] = [{ name: "result", expression: "a + b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBeNull();
    });

    it("returns null when field value is undefined", () => {
      const rows = [{ a: 10, b: undefined }];
      const formulas: Formula[] = [{ name: "result", expression: "a * b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBeNull();
    });
  });

  describe("type mismatch → null", () => {
    it("returns null for non-numeric field value", () => {
      const rows = [{ a: 10, b: "hello" }];
      const formulas: Formula[] = [{ name: "result", expression: "a + b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBeNull();
    });

    it("handles string numbers correctly (coercion)", () => {
      const rows = [{ a: "10", b: 5 }];
      const formulas: Formula[] = [{ name: "result", expression: "a + b", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBe(15);
    });
  });

  describe("multiple formulas", () => {
    it("evaluates multiple formulas and earlier results are available to later ones", () => {
      const rows = [{ revenue: 1000, cost: 600 }];
      const formulas: Formula[] = [
        { name: "margin", expression: "revenue - cost", type: "number" },
        { name: "margin_pct", expression: "margin / revenue * 100", type: "percentage" },
      ];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["margin"]).toBe(400);
      expect(result[0]!["margin_pct"]).toBe(40);
    });

    it("does not modify original row objects", () => {
      const originalRow = { a: 10, b: 5 };
      const rows = [originalRow];
      const formulas: Formula[] = [{ name: "sum", expression: "a + b", type: "number" }];
      evaluateFormulas(rows, formulas);
      expect(originalRow).toEqual({ a: 10, b: 5 });
    });
  });

  describe("numeric literals", () => {
    it("handles numeric constants in expressions", () => {
      const rows = [{ price: 100 }];
      const formulas: Formula[] = [{ name: "tax", expression: "price * 18 / 100", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["tax"]).toBe(18);
    });

    it("handles decimal literals", () => {
      const rows = [{ base: 200 }];
      const formulas: Formula[] = [{ name: "result", expression: "base * 1.5", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBe(300);
    });
  });

  describe("unary operators", () => {
    it("handles unary minus", () => {
      const rows = [{ a: 5 }];
      const formulas: Formula[] = [{ name: "neg", expression: "-a", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["neg"]).toBe(-5);
    });

    it("handles unary plus", () => {
      const rows = [{ a: 5 }];
      const formulas: Formula[] = [{ name: "pos", expression: "+a", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["pos"]).toBe(5);
    });
  });

  describe("operator precedence", () => {
    it("multiplication before addition", () => {
      const rows = [{ a: 2, b: 3, c: 4 }];
      const formulas: Formula[] = [{ name: "result", expression: "a + b * c", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBe(14);
    });

    it("division before subtraction", () => {
      const rows = [{ a: 10, b: 6, c: 2 }];
      const formulas: Formula[] = [{ name: "result", expression: "a - b / c", type: "number" }];
      const result = evaluateFormulas(rows, formulas);
      expect(result[0]!["result"]).toBe(7);
    });
  });

  describe("empty inputs", () => {
    it("returns empty array for empty rows", () => {
      const formulas: Formula[] = [{ name: "x", expression: "a + b", type: "number" }];
      const result = evaluateFormulas([], formulas);
      expect(result).toEqual([]);
    });

    it("returns rows unchanged when no formulas", () => {
      const rows = [{ a: 1, b: 2 }];
      const result = evaluateFormulas(rows, []);
      expect(result).toEqual([{ a: 1, b: 2 }]);
    });
  });
});

describe("formatFormulaValue", () => {
  it("formats number type as-is", () => {
    expect(formatFormulaValue(42.5, "number")).toBe("42.5");
  });

  it("formats percentage type with % suffix", () => {
    expect(formatFormulaValue(30, "percentage")).toBe("30%");
  });

  it("formats currency type as locale string", () => {
    const result = formatFormulaValue(1234.56, "currency", "en-US");
    expect(result).toContain("1,234.56");
  });

  it("returns null for null input", () => {
    expect(formatFormulaValue(null, "number")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(formatFormulaValue(undefined, "number")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(formatFormulaValue("hello", "number")).toBeNull();
  });
});
