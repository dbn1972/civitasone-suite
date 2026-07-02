/**
 * Coverage tests for apar/engine.ts + employee/dept-domain.ts + shared/sanitize.ts.
 * Pure functions — no DB or I/O.
 */
import { describe, it, expect } from "vitest";
import { bandForGrade, computeOverallGrade, type ScoreInput } from "../src/modules/apar/engine.js";
import { isValidHierarchyLevel, isValidDeptType, CENTRAL_GOVT_TYPES, PSU_TYPES } from "../src/modules/employee/dept-domain.js";
import { sanitizeString, sanitizeInput } from "../src/shared/sanitize.js";

// ═════════════════════════════════════════════════════════
// APAR ENGINE
// ═════════════════════════════════════════════════════════

describe("apar/engine — bandForGrade()", () => {
  it("returns Outstanding for >= 9", () => {
    expect(bandForGrade(9)).toBe("Outstanding");
    expect(bandForGrade(10)).toBe("Outstanding");
    expect(bandForGrade(9.5)).toBe("Outstanding");
  });

  it("returns Very Good for >= 7 and < 9", () => {
    expect(bandForGrade(7)).toBe("Very Good");
    expect(bandForGrade(8.9)).toBe("Very Good");
  });

  it("returns Good for >= 5 and < 7", () => {
    expect(bandForGrade(5)).toBe("Good");
    expect(bandForGrade(6.99)).toBe("Good");
  });

  it("returns Average for >= 4 and < 5", () => {
    expect(bandForGrade(4)).toBe("Average");
    expect(bandForGrade(4.99)).toBe("Average");
  });

  it("returns Below Average for < 4", () => {
    expect(bandForGrade(3.99)).toBe("Below Average");
    expect(bandForGrade(1)).toBe("Below Average");
    expect(bandForGrade(0)).toBe("Below Average");
  });
});

describe("apar/engine — computeOverallGrade()", () => {
  it("computes weighted mean correctly", () => {
    const scores: ScoreInput[] = [
      { attribute: "leadership", weight: 2, score: 8 },
      { attribute: "communication", weight: 1, score: 6 },
    ];
    // (8*2 + 6*1) / (2+1) = 22/3 = 7.33
    const r = computeOverallGrade(scores);
    expect(r.overallGrade).toBeCloseTo(7.33, 2);
    expect(r.band).toBe("Very Good");
    expect(r.totalWeight).toBe(3);
    expect(r.attributeCount).toBe(2);
  });

  it("uses weight=1 for zero/negative weights", () => {
    const scores: ScoreInput[] = [
      { attribute: "a", weight: 0, score: 8 },
      { attribute: "b", weight: -1, score: 6 },
    ];
    // Both default to weight 1: (8+6)/2 = 7
    const r = computeOverallGrade(scores);
    expect(r.overallGrade).toBe(7);
  });

  it("throws for empty scores", () => {
    expect(() => computeOverallGrade([])).toThrow("zero attribute scores");
  });

  it("handles single score", () => {
    const r = computeOverallGrade([{ attribute: "only", weight: 1, score: 9.5 }]);
    expect(r.overallGrade).toBe(9.5);
    expect(r.band).toBe("Outstanding");
  });
});

// ═════════════════════════════════════════════════════════
// DEPT DOMAIN
// ═════════════════════════════════════════════════════════

describe("employee/dept-domain — isValidHierarchyLevel()", () => {
  it("returns true when child > parent", () => {
    expect(isValidHierarchyLevel(2, 1)).toBe(true);
  });

  it("returns false when child <= parent", () => {
    expect(isValidHierarchyLevel(1, 1)).toBe(false);
    expect(isValidHierarchyLevel(1, 2)).toBe(false);
  });

  it("returns true when levels are null (skip enforcement)", () => {
    expect(isValidHierarchyLevel(null, 1)).toBe(true);
    expect(isValidHierarchyLevel(2, null)).toBe(true);
    expect(isValidHierarchyLevel(null, null)).toBe(true);
  });
});

describe("employee/dept-domain — isValidDeptType()", () => {
  it("returns true for known central govt types", () => {
    expect(isValidDeptType("ministry", "central_govt")).toBe(true);
    expect(isValidDeptType("department", "central_govt")).toBe(true);
    expect(isValidDeptType("section", "central_govt")).toBe(true);
  });

  it("returns true for known PSU types", () => {
    expect(isValidDeptType("company", "psu")).toBe(true);
    expect(isValidDeptType("plant", "psu")).toBe(true);
  });

  it("returns false for unknown type", () => {
    expect(isValidDeptType("galactic_federation", "central_govt")).toBe(false);
  });

  it("returns true for null type (freeform)", () => {
    expect(isValidDeptType(null, "psu")).toBe(true);
    expect(isValidDeptType(undefined, "central_govt")).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════
// SANITIZE
// ═════════════════════════════════════════════════════════

describe("shared/sanitize — sanitizeString()", () => {
  it("removes script tags", () => {
    expect(sanitizeString('<script>alert("xss")</script>Hello')).toBe("Hello");
  });

  it("removes HTML tags", () => {
    expect(sanitizeString("<b>bold</b> text")).toBe("bold text");
  });

  it("removes javascript: protocol", () => {
    expect(sanitizeString("javascript:alert(1)")).toBe("alert(1)");
  });

  it("removes event handlers", () => {
    expect(sanitizeString("onerror=hack")).toBe("hack");
    expect(sanitizeString("onclick =evil")).toBe("evil");
  });

  it("trims whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("passes clean strings through", () => {
    expect(sanitizeString("Normal text 123")).toBe("Normal text 123");
  });
});

describe("shared/sanitize — sanitizeInput()", () => {
  it("deep sanitizes object string values", () => {
    const input = { name: "<b>John</b>", nested: { desc: "<script>x</script>safe" } };
    const r = sanitizeInput(input);
    expect(r.name).toBe("John");
    expect(r.nested.desc).toBe("safe");
  });

  it("sanitizes array elements", () => {
    const input = ["<b>one</b>", "<script>two</script>three"];
    const r = sanitizeInput(input);
    expect(r[0]).toBe("one");
    expect(r[1]).toBe("three");
  });

  it("passes non-string values through", () => {
    const input = { count: 42, flag: true, empty: null };
    const r = sanitizeInput(input);
    expect(r.count).toBe(42);
    expect(r.flag).toBe(true);
    expect(r.empty).toBeNull();
  });
});
