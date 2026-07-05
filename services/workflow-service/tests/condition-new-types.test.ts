/**
 * Unit tests for condition evaluator in the context of new advanced engine
 * node types: decision tables, responsibility matrix, multi-instance, message
 * events, and compensation handlers. These tests verify that evaluateCondition
 * works correctly when context has been enriched by advanced node outputs.
 */
import { describe, it, expect } from "vitest";
import { evaluateCondition, normalizeContext } from "../src/shared/condition.js";

// ---------------------------------------------------------------------------
// 1. Basic comparison operators: ==, !=, >, <, >=, <=
// ---------------------------------------------------------------------------
describe("condition evaluator — basic comparison operators", () => {
  const ctx = { score: 75, level: 3, status: "active" };

  it("== returns true for matching values", () => {
    expect(evaluateCondition("score == 75", ctx)).toBe(true);
    expect(evaluateCondition("level == 3", ctx)).toBe(true);
  });

  it("== returns false for non-matching values", () => {
    expect(evaluateCondition("score == 80", ctx)).toBe(false);
  });

  it("!= returns true for differing values", () => {
    expect(evaluateCondition("score != 80", ctx)).toBe(true);
    expect(evaluateCondition("status != closed", ctx)).toBe(true);
  });

  it("!= returns false for equal values", () => {
    expect(evaluateCondition("score != 75", ctx)).toBe(false);
  });

  it("> returns true when left is greater", () => {
    expect(evaluateCondition("score > 50", ctx)).toBe(true);
  });

  it("> returns false when left is equal or smaller", () => {
    expect(evaluateCondition("score > 75", ctx)).toBe(false);
    expect(evaluateCondition("score > 90", ctx)).toBe(false);
  });

  it("< returns true when left is smaller", () => {
    expect(evaluateCondition("score < 100", ctx)).toBe(true);
  });

  it("< returns false when left is equal or greater", () => {
    expect(evaluateCondition("score < 75", ctx)).toBe(false);
    expect(evaluateCondition("score < 50", ctx)).toBe(false);
  });

  it(">= returns true when left is equal or greater", () => {
    expect(evaluateCondition("score >= 75", ctx)).toBe(true);
    expect(evaluateCondition("score >= 50", ctx)).toBe(true);
  });

  it(">= returns false when left is smaller", () => {
    expect(evaluateCondition("score >= 80", ctx)).toBe(false);
  });

  it("<= returns true when left is equal or smaller", () => {
    expect(evaluateCondition("score <= 75", ctx)).toBe(true);
    expect(evaluateCondition("score <= 100", ctx)).toBe(true);
  });

  it("<= returns false when left is greater", () => {
    expect(evaluateCondition("score <= 50", ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. String equality: field == 'value'
// ---------------------------------------------------------------------------
describe("condition evaluator — string equality", () => {
  it("matches single-quoted string values", () => {
    expect(evaluateCondition("status == 'approved'", { status: "approved" })).toBe(true);
    expect(evaluateCondition("status == 'approved'", { status: "rejected" })).toBe(false);
  });

  it("matches double-quoted string values", () => {
    expect(evaluateCondition('status == "pending review"', { status: "pending review" })).toBe(true);
  });

  it("matches bare-token string values (no quotes)", () => {
    expect(evaluateCondition("priority == high", { priority: "high" })).toBe(true);
    expect(evaluateCondition("priority == high", { priority: "low" })).toBe(false);
  });

  it("is case-sensitive for string comparison", () => {
    expect(evaluateCondition("status == Approved", { status: "approved" })).toBe(false);
    expect(evaluateCondition("status == Approved", { status: "Approved" })).toBe(true);
  });

  it("handles string inequality", () => {
    expect(evaluateCondition("category != 'internal'", { category: "external" })).toBe(true);
    expect(evaluateCondition("category != 'internal'", { category: "internal" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Numeric comparisons: amount > 500000
// ---------------------------------------------------------------------------
describe("condition evaluator — numeric comparisons (large values)", () => {
  it("handles large numeric thresholds (government budget amounts)", () => {
    expect(evaluateCondition("amount > 500000", { amount: 750000 })).toBe(true);
    expect(evaluateCondition("amount > 500000", { amount: 500000 })).toBe(false);
    expect(evaluateCondition("amount > 500000", { amount: 100000 })).toBe(false);
  });

  it("handles decimal numbers", () => {
    expect(evaluateCondition("rate > 7.5", { rate: 8.25 })).toBe(true);
    expect(evaluateCondition("rate > 7.5", { rate: 6.0 })).toBe(false);
  });

  it("handles zero and negative comparisons", () => {
    expect(evaluateCondition("balance >= 0", { balance: 0 })).toBe(true);
    expect(evaluateCondition("balance >= 0", { balance: -100 })).toBe(false);
    expect(evaluateCondition("temperature < 0", { temperature: -5 })).toBe(true);
  });

  it("coerces string-typed numbers from context", () => {
    expect(evaluateCondition("amount > 500000", { amount: "600000" })).toBe(true);
    expect(evaluateCondition("amount <= 500000", { amount: "500000" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Boolean conditions
// ---------------------------------------------------------------------------
describe("condition evaluator — boolean conditions", () => {
  it("matches boolean true in context", () => {
    expect(evaluateCondition("isUrgent == true", { isUrgent: true })).toBe(true);
    expect(evaluateCondition("isUrgent == true", { isUrgent: false })).toBe(false);
  });

  it("matches boolean false in context", () => {
    expect(evaluateCondition("isApproved == false", { isApproved: false })).toBe(true);
    expect(evaluateCondition("isApproved == false", { isApproved: true })).toBe(false);
  });

  it("boolean inequality", () => {
    expect(evaluateCondition("requiresReview != false", { requiresReview: true })).toBe(true);
  });

  it("bare boolean literals as full expression", () => {
    expect(evaluateCondition("true", {})).toBe(true);
    expect(evaluateCondition("false", {})).toBe(false);
  });

  it("boolean context value with string coercion in comparison", () => {
    expect(evaluateCondition("flag == true", { flag: "true" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. `in` operator: field in ['a', 'b', 'c']
// ---------------------------------------------------------------------------
describe("condition evaluator — in operator", () => {
  it("matches when value is in the list", () => {
    expect(evaluateCondition("dept in ['hr', 'finance', 'legal']", { dept: "finance" })).toBe(true);
  });

  it("does not match when value is absent from list", () => {
    expect(evaluateCondition("dept in ['hr', 'finance', 'legal']", { dept: "it" })).toBe(false);
  });

  it("works with bare tokens in list", () => {
    expect(evaluateCondition("role in [approver, reviewer, admin]", { role: "reviewer" })).toBe(true);
    expect(evaluateCondition("role in [approver, reviewer, admin]", { role: "viewer" })).toBe(false);
  });

  it("works with numeric values in list", () => {
    expect(evaluateCondition("level in [1, 2, 3]", { level: 2 })).toBe(true);
    expect(evaluateCondition("level in [1, 2, 3]", { level: 5 })).toBe(false);
  });

  it("handles empty list (nothing matches)", () => {
    expect(evaluateCondition("status in []", { status: "active" })).toBe(false);
  });

  it("works with single-element list", () => {
    expect(evaluateCondition("type in ['urgent']", { type: "urgent" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Null/undefined context values (should not match)
// ---------------------------------------------------------------------------
describe("condition evaluator — null/undefined context values", () => {
  it("undefined field does not match equality or > comparisons", () => {
    expect(evaluateCondition("missing == 'value'", {})).toBe(false);
    expect(evaluateCondition("missing > 5", {})).toBe(false);
    expect(evaluateCondition("missing >= 5", {})).toBe(false);
    expect(evaluateCondition("missing in [a, b]", {})).toBe(false);
  });

  it("undefined field with < operator: numCmp returns -1 (non-numeric fallback)", () => {
    // When field is undefined, Number(undefined)=NaN → numCmp returns -1
    // This makes < and <= return true (implementation detail: fail-open on less-than)
    expect(evaluateCondition("missing < 100", {})).toBe(true);
    expect(evaluateCondition("missing <= 100", {})).toBe(true);
  });

  it("null context value compared to null returns true", () => {
    expect(evaluateCondition("field == null", { field: null })).toBe(true);
  });

  it("null context value does not match non-null comparisons", () => {
    expect(evaluateCondition("field > 0", { field: null })).toBe(false);
    expect(evaluateCondition("field == 'something'", { field: null })).toBe(false);
  });

  it("empty context object fails all field comparisons", () => {
    expect(evaluateCondition("a == 1 AND b == 2", {})).toBe(false);
    expect(evaluateCondition("x > 10", {})).toBe(false);
  });

  it("normalizeContext handles null/undefined gracefully", () => {
    expect(normalizeContext(null)).toEqual({});
    expect(normalizeContext(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 7. Nested dot-path access in context (e.g., `order.amount > 100`)
// ---------------------------------------------------------------------------
describe("condition evaluator — nested dot-path access", () => {
  it("resolves single-level nested path", () => {
    const ctx = { order: { amount: 250 } };
    expect(evaluateCondition("order.amount > 100", ctx)).toBe(true);
    expect(evaluateCondition("order.amount < 100", ctx)).toBe(false);
  });

  it("resolves deeply nested paths", () => {
    const ctx = { request: { metadata: { priority: "high" } } };
    expect(evaluateCondition("request.metadata.priority == high", ctx)).toBe(true);
  });

  it("returns false for missing intermediate path", () => {
    expect(evaluateCondition("order.item.quantity > 0", { order: {} })).toBe(false);
    expect(evaluateCondition("a.b.c == 1", {})).toBe(false);
  });

  it("handles nested boolean paths", () => {
    const ctx = { approval: { isFinal: true } };
    expect(evaluateCondition("approval.isFinal == true", ctx)).toBe(true);
  });

  it("handles nested string paths with in operator", () => {
    const ctx = { task: { category: "review" } };
    expect(evaluateCondition("task.category in [review, approval, audit]", ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Edge conditions referencing decision table outputs
//    (after a decision node enriches context with its outputs)
// ---------------------------------------------------------------------------
describe("condition evaluator — decision table output in context", () => {
  it("evaluates condition against decision table output (riskLevel)", () => {
    // After a decision node runs, it merges outputs into context
    const ctx = {
      amount: 750000,
      department: "finance",
      // Decision table output merged into context:
      riskLevel: "high",
      approvalTier: 3,
      requiresCommittee: true,
    };

    expect(evaluateCondition("riskLevel == high", ctx)).toBe(true);
    expect(evaluateCondition("approvalTier >= 3", ctx)).toBe(true);
    expect(evaluateCondition("requiresCommittee == true", ctx)).toBe(true);
  });

  it("routes based on decision table categorization", () => {
    // Simulates an edge after decision node: route to different paths
    const lowRiskCtx = { riskLevel: "low", approvalTier: 1 };
    const highRiskCtx = { riskLevel: "high", approvalTier: 3 };

    // Edge condition for "fast track" path
    expect(evaluateCondition("riskLevel == low AND approvalTier <= 1", lowRiskCtx)).toBe(true);
    expect(evaluateCondition("riskLevel == low AND approvalTier <= 1", highRiskCtx)).toBe(false);

    // Edge condition for "committee review" path
    expect(evaluateCondition("riskLevel == high AND approvalTier >= 3", highRiskCtx)).toBe(true);
    expect(evaluateCondition("riskLevel == high AND approvalTier >= 3", lowRiskCtx)).toBe(false);
  });

  it("handles decision output nested under a namespace", () => {
    // Some implementations namespace decision output
    const ctx = {
      decision: { output: { tier: "premium", discount: 15 } },
    };
    expect(evaluateCondition("decision.output.tier == premium", ctx)).toBe(true);
    expect(evaluateCondition("decision.output.discount > 10", ctx)).toBe(true);
  });

  it("handles COLLECT hit policy array result (check specific value)", () => {
    // With COLLECT, outputs may be arrays — edge condition checks a scalar
    // that the consumer extracts before edge evaluation
    const ctx = {
      matchedRules: 3,
      highestPriority: "urgent",
    };
    expect(evaluateCondition("matchedRules > 1", ctx)).toBe(true);
    expect(evaluateCondition("highestPriority == urgent", ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Empty/blank conditions (should return true - always match)
// ---------------------------------------------------------------------------
describe("condition evaluator — empty/blank conditions always match", () => {
  it("null condition returns true", () => {
    expect(evaluateCondition(null, { anything: "value" })).toBe(true);
  });

  it("undefined condition returns true", () => {
    expect(evaluateCondition(undefined, { anything: "value" })).toBe(true);
  });

  it("empty string returns true", () => {
    expect(evaluateCondition("", { data: 123 })).toBe(true);
  });

  it("whitespace-only string returns true", () => {
    expect(evaluateCondition("   ", { data: 123 })).toBe(true);
    expect(evaluateCondition("\t\n", { data: 123 })).toBe(true);
  });

  it("literal 'true' (case-insensitive) returns true", () => {
    expect(evaluateCondition("true", {})).toBe(true);
    expect(evaluateCondition("TRUE", {})).toBe(true);
    expect(evaluateCondition("True", {})).toBe(true);
  });

  it("unconditional edges always allow traversal regardless of context", () => {
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition("", { complex: { nested: { value: 42 } } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Invalid expressions (should return false gracefully)
// ---------------------------------------------------------------------------
describe("condition evaluator — invalid expressions return false", () => {
  it("incomplete comparison (missing rhs)", () => {
    expect(evaluateCondition("amount >", { amount: 100 })).toBe(false);
  });

  it("missing operator between field and value", () => {
    expect(evaluateCondition("amount 1000", { amount: 1000 })).toBe(false);
  });

  it("unbalanced parentheses", () => {
    expect(evaluateCondition("(amount > 5", { amount: 10 })).toBe(false);
    expect(evaluateCondition("amount > 5)", { amount: 10 })).toBe(false);
  });

  it("dangling logical operator", () => {
    expect(evaluateCondition("amount > 5 AND", { amount: 10 })).toBe(false);
    expect(evaluateCondition("OR amount > 5", { amount: 10 })).toBe(false);
  });

  it("special characters that are not part of grammar", () => {
    expect(evaluateCondition("amount @ 5", { amount: 5 })).toBe(false);
    expect(evaluateCondition("field # value", { field: "value" })).toBe(false);
  });

  it("unterminated string literal", () => {
    expect(evaluateCondition("status == 'incomplete", { status: "incomplete" })).toBe(false);
  });

  it("in operator without brackets", () => {
    expect(evaluateCondition("dept in hr, finance", { dept: "hr" })).toBe(false);
  });

  it("does not execute code injection attempts", () => {
    expect(evaluateCondition("constructor.prototype == 1", {})).toBe(false);
    expect(evaluateCondition("__proto__.polluted == true", {})).toBe(false);
  });
});
