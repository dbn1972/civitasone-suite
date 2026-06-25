/**
 * Safe condition-parser tests (src/shared/condition.ts). Pure logic, no DB.
 * Covers the AND/OR/NOT/in grammar, dotted paths, fail-closed runtime behaviour,
 * and the deploy-time validateCondition() gate.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  validateCondition,
  normalizeContext,
} from "../src/shared/condition.js";

describe("evaluateCondition — unconditional / literals", () => {
  it("null / undefined / empty / true are unconditional (always true)", () => {
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition(undefined, {})).toBe(true);
    expect(evaluateCondition("", {})).toBe(true);
    expect(evaluateCondition("   ", {})).toBe(true);
    expect(evaluateCondition("true", {})).toBe(true);
    expect(evaluateCondition("TRUE", {})).toBe(true);
  });
  it("false literal is always false", () => {
    expect(evaluateCondition("false", { amount: 99 })).toBe(false);
  });
});

describe("evaluateCondition — comparisons", () => {
  it("numeric comparisons", () => {
    expect(evaluateCondition("amount > 1000", { amount: 5000 })).toBe(true);
    expect(evaluateCondition("amount > 1000", { amount: 500 })).toBe(false);
    expect(evaluateCondition("amount >= 1000", { amount: 1000 })).toBe(true);
    expect(evaluateCondition("amount <= 1000", { amount: 1000 })).toBe(true);
    expect(evaluateCondition("amount < 1000", { amount: 1000 })).toBe(false);
  });
  it("string-typed numeric context still compares numerically", () => {
    expect(evaluateCondition("amount > 1000", { amount: "5000" })).toBe(true);
  });
  it("equality and inequality (loose, type-coercing)", () => {
    expect(evaluateCondition("priority == high", { priority: "high" })).toBe(true);
    expect(evaluateCondition("priority != high", { priority: "low" })).toBe(true);
    expect(evaluateCondition("flag == true", { flag: true })).toBe(true);
    expect(evaluateCondition("count == 3", { count: 3 })).toBe(true);
  });
  it("quoted string rhs with spaces", () => {
    expect(evaluateCondition("status == 'in review'", { status: "in review" })).toBe(true);
  });
  it("dotted path resolution into nested context", () => {
    expect(evaluateCondition("request.priority == urgent", { request: { priority: "urgent" } })).toBe(true);
    expect(evaluateCondition("a.b.c > 5", { a: { b: { c: 10 } } })).toBe(true);
  });
  it("missing path resolves undefined → comparison false (fail closed)", () => {
    expect(evaluateCondition("missing.key == 1", {})).toBe(false);
    expect(evaluateCondition("missing > 5", {})).toBe(false);
  });
  it("in-operator over a list", () => {
    expect(evaluateCondition("dept in [hr, finance, legal]", { dept: "finance" })).toBe(true);
    expect(evaluateCondition("dept in [hr, finance]", { dept: "it" })).toBe(false);
    expect(evaluateCondition("code in [1, 2, 3]", { code: 2 })).toBe(true);
  });
});

describe("evaluateCondition — boolean composition (AND / OR / NOT, precedence, parens)", () => {
  it("AND requires both", () => {
    expect(evaluateCondition("amount > 1000 AND priority == high", { amount: 2000, priority: "high" })).toBe(true);
    expect(evaluateCondition("amount > 1000 AND priority == high", { amount: 2000, priority: "low" })).toBe(false);
  });
  it("OR requires either", () => {
    expect(evaluateCondition("amount > 1000 OR priority == high", { amount: 10, priority: "high" })).toBe(true);
    expect(evaluateCondition("amount > 1000 OR priority == high", { amount: 10, priority: "low" })).toBe(false);
  });
  it("NOT negates", () => {
    expect(evaluateCondition("NOT amount > 1000", { amount: 10 })).toBe(true);
    expect(evaluateCondition("!(amount > 1000)", { amount: 5000 })).toBe(false);
  });
  it("symbolic operators && || behave like AND OR", () => {
    expect(evaluateCondition("amount > 1000 && priority == high", { amount: 2000, priority: "high" })).toBe(true);
    expect(evaluateCondition("amount > 1000 || priority == high", { amount: 1, priority: "high" })).toBe(true);
  });
  it("precedence: AND binds tighter than OR", () => {
    // false OR (true AND true) === true
    expect(evaluateCondition("a == 1 OR b == 2 AND c == 3", { a: 9, b: 2, c: 3 })).toBe(true);
    // (false OR (true AND false)) === false
    expect(evaluateCondition("a == 1 OR b == 2 AND c == 3", { a: 9, b: 2, c: 9 })).toBe(false);
  });
  it("parentheses override precedence", () => {
    // (false OR true) AND false === false
    expect(evaluateCondition("(a == 1 OR b == 2) AND c == 3", { a: 9, b: 2, c: 9 })).toBe(false);
    expect(evaluateCondition("(a == 1 OR b == 2) AND c == 3", { a: 9, b: 2, c: 3 })).toBe(true);
  });
});

describe("evaluateCondition — fail closed on malformed input (no eval/Function)", () => {
  it("malformed expressions return false rather than throwing", () => {
    expect(evaluateCondition("amount >", { amount: 5 })).toBe(false);
    expect(evaluateCondition("(amount > 1", { amount: 5 })).toBe(false);
    expect(evaluateCondition("amount 1000", { amount: 5 })).toBe(false);
    expect(evaluateCondition("&& priority", { priority: "x" })).toBe(false);
  });
  it("does not execute injected code (no JS evaluation)", () => {
    // a JS-injection-looking string is just a (malformed) condition → false.
    expect(evaluateCondition("process.exit(1) == 1", {})).toBe(false);
  });
});

describe("validateCondition — deploy-time gate", () => {
  it("accepts empty/true/false and well-formed expressions", () => {
    expect(validateCondition(null)).toBeNull();
    expect(validateCondition("")).toBeNull();
    expect(validateCondition("true")).toBeNull();
    expect(validateCondition("false")).toBeNull();
    expect(validateCondition("amount > 1000 AND dept in [hr, finance]")).toBeNull();
  });
  it("rejects malformed expressions with an error message", () => {
    expect(validateCondition("amount >")).not.toBeNull();
    expect(validateCondition("(unbalanced")).not.toBeNull();
    expect(validateCondition("a == 1 AND")).not.toBeNull();
  });
});

describe("normalizeContext", () => {
  it("passes objects through, parses JSON strings, defaults junk to {}", () => {
    expect(normalizeContext({ a: 1 })).toEqual({ a: 1 });
    expect(normalizeContext('{"a":2}')).toEqual({ a: 2 });
    expect(normalizeContext(null)).toEqual({});
    expect(normalizeContext(undefined)).toEqual({});
    expect(normalizeContext("not json")).toEqual({});
    expect(normalizeContext(42)).toEqual({});
  });
});
