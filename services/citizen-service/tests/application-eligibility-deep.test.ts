/**
 * Citizen Service — Application Domain + Eligibility Engine: Deep tests.
 *
 * Tests application status transitions, SLA breach, document assertions,
 * and the full eligibility rule evaluator with all operators.
 *
 * Source: modules/application/domain.ts, modules/eligibility/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  APPLICATION_STATUSES, assertStatusTransition, isResolvedStatus,
  computeDeadline, isSlaBreached, assertRequiredDocuments,
} from "../src/modules/application/domain.js";
import {
  evaluateRule, evaluateEligibility, assertRulesWellFormed,
  ELIGIBILITY_OPS, type EligibilityRule, type Subject,
} from "../src/modules/eligibility/domain.js";

// ═══ Application Status Machine ═══

describe("assertStatusTransition — application lifecycle", () => {
  const valid: [string, string][] = [
    ["submitted", "under_review"], ["submitted", "pending_docs"], ["submitted", "rejected"],
    ["under_review", "pending_docs"], ["under_review", "approved"], ["under_review", "rejected"],
    ["pending_docs", "under_review"], ["pending_docs", "rejected"],
    ["approved", "issued"],
  ];
  for (const [from, to] of valid) {
    it(`${from} → ${to}`, () => expect(() => assertStatusTransition(from, to as any)).not.toThrow());
  }

  const invalid: [string, string][] = [
    ["submitted", "approved"], ["submitted", "issued"],
    ["under_review", "submitted"], ["under_review", "issued"],
    ["pending_docs", "approved"], ["pending_docs", "issued"],
    ["approved", "rejected"], ["approved", "submitted"],
    ["rejected", "approved"], ["rejected", "submitted"],
    ["issued", "approved"], ["issued", "rejected"],
  ];
  for (const [from, to] of invalid) {
    it(`${from} → ${to} is illegal`, () => expect(() => assertStatusTransition(from, to as any)).toThrow("INVALID_TRANSITION"));
  }
});

describe("isResolvedStatus", () => {
  it("approved/rejected/issued are resolved", () => {
    expect(isResolvedStatus("approved")).toBe(true);
    expect(isResolvedStatus("rejected")).toBe(true);
    expect(isResolvedStatus("issued")).toBe(true);
  });
  it("submitted/under_review/pending_docs are NOT resolved", () => {
    expect(isResolvedStatus("submitted")).toBe(false);
    expect(isResolvedStatus("under_review")).toBe(false);
    expect(isResolvedStatus("pending_docs")).toBe(false);
  });
});

describe("isSlaBreached — deadline detection", () => {
  it("breached when past deadline and not resolved", () => {
    const created = new Date("2026-01-01");
    const now = new Date("2026-02-15"); // 45 days > 30
    expect(isSlaBreached(created, 30, "submitted", now)).toBe(true);
  });
  it("not breached when within deadline", () => {
    const created = new Date("2026-07-01");
    const now = new Date("2026-07-10");
    expect(isSlaBreached(created, 30, "submitted", now)).toBe(false);
  });
  it("not breached when resolved (even past deadline)", () => {
    const created = new Date("2020-01-01");
    expect(isSlaBreached(created, 30, "approved")).toBe(false);
    expect(isSlaBreached(created, 30, "rejected")).toBe(false);
  });
});

describe("assertRequiredDocuments", () => {
  it("passes when all required docs are provided", () => {
    expect(() => assertRequiredDocuments(["id_proof", "address_proof"], ["id_proof", "address_proof", "photo"])).not.toThrow();
  });
  it("throws MISSING_DOCUMENTS when some are absent", () => {
    expect(() => assertRequiredDocuments(["id_proof", "income_cert"], ["id_proof"])).toThrow("MISSING_DOCUMENTS");
  });
  it("passes when required list is empty", () => {
    expect(() => assertRequiredDocuments([], [])).not.toThrow();
  });
});

// ═══ Eligibility Engine ═══

describe("evaluateRule — single rule evaluation", () => {
  it("exists: true when attribute present", () => {
    expect(evaluateRule({ id: "r1", attribute: "age", op: "exists", effect: "disqualify" }, { age: 25 })).toBe(true);
  });
  it("exists: false when attribute missing", () => {
    expect(evaluateRule({ id: "r1", attribute: "age", op: "exists", effect: "disqualify" }, {})).toBe(false);
  });
  it("missing: true when attribute absent", () => {
    expect(evaluateRule({ id: "r1", attribute: "age", op: "missing", effect: "disqualify" }, {})).toBe(true);
  });
  it("eq: exact match", () => {
    expect(evaluateRule({ id: "r1", attribute: "state", op: "eq", value: "UP", effect: "disqualify" }, { state: "UP" })).toBe(true);
    expect(evaluateRule({ id: "r1", attribute: "state", op: "eq", value: "UP", effect: "disqualify" }, { state: "MP" })).toBe(false);
  });
  it("neq: not equal", () => {
    expect(evaluateRule({ id: "r1", attribute: "state", op: "neq", value: "UP", effect: "disqualify" }, { state: "MP" })).toBe(true);
  });
  it("gt: greater than (numeric)", () => {
    expect(evaluateRule({ id: "r1", attribute: "age", op: "gt", value: 18, effect: "disqualify" }, { age: 25 })).toBe(true);
    expect(evaluateRule({ id: "r1", attribute: "age", op: "gt", value: 18, effect: "disqualify" }, { age: 18 })).toBe(false);
  });
  it("gte: greater or equal", () => {
    expect(evaluateRule({ id: "r1", attribute: "age", op: "gte", value: 18, effect: "disqualify" }, { age: 18 })).toBe(true);
  });
  it("lt: less than", () => {
    expect(evaluateRule({ id: "r1", attribute: "income", op: "lt", value: 100000, effect: "disqualify" }, { income: 50000 })).toBe(true);
  });
  it("lte: less or equal", () => {
    expect(evaluateRule({ id: "r1", attribute: "income", op: "lte", value: 100000, effect: "disqualify" }, { income: 100000 })).toBe(true);
  });
  it("in: value in array", () => {
    expect(evaluateRule({ id: "r1", attribute: "category", op: "in", value: ["SC", "ST", "OBC"], effect: "disqualify" }, { category: "SC" })).toBe(true);
    expect(evaluateRule({ id: "r1", attribute: "category", op: "in", value: ["SC", "ST"], effect: "disqualify" }, { category: "General" })).toBe(false);
  });
  it("nin: value NOT in array", () => {
    expect(evaluateRule({ id: "r1", attribute: "category", op: "nin", value: ["blacklisted"], effect: "disqualify" }, { category: "General" })).toBe(true);
  });
  it("non-numeric gt/lt returns false", () => {
    expect(evaluateRule({ id: "r1", attribute: "name", op: "gt", value: 10, effect: "disqualify" }, { name: "abc" })).toBe(false);
  });
});

describe("evaluateEligibility — full rule set", () => {
  const rules: EligibilityRule[] = [
    { id: "r1", attribute: "age", op: "gte", value: 18, effect: "disqualify", label: "Must be 18+" },
    { id: "r2", attribute: "income", op: "lte", value: 500000, effect: "disqualify", label: "Income below 5 lakh" },
    { id: "r3", attribute: "docs_complete", op: "eq", value: true, effect: "refer", label: "Docs verification" },
  ];

  it("eligible when all rules pass", () => {
    const result = evaluateEligibility(rules, { age: 25, income: 300000, docs_complete: true });
    expect(result.outcome).toBe("eligible");
    expect(result.reasons.every(r => r.passed)).toBe(true);
  });

  it("not_eligible when disqualify rule fails", () => {
    const result = evaluateEligibility(rules, { age: 16, income: 300000, docs_complete: true });
    expect(result.outcome).toBe("not_eligible");
    expect(result.reasons.find(r => r.ruleId === "r1")?.passed).toBe(false);
  });

  it("refer_manual when refer rule fails but no disqualify", () => {
    const result = evaluateEligibility(rules, { age: 25, income: 300000, docs_complete: false });
    expect(result.outcome).toBe("refer_manual");
  });

  it("not_eligible takes precedence over refer", () => {
    const result = evaluateEligibility(rules, { age: 16, income: 300000, docs_complete: false });
    expect(result.outcome).toBe("not_eligible"); // disqualify > refer
  });

  it("empty rules → eligible", () => {
    const result = evaluateEligibility([], { anything: "value" });
    expect(result.outcome).toBe("eligible");
    expect(result.reasons).toEqual([]);
  });
});

describe("assertRulesWellFormed — structural validation", () => {
  it("accepts valid rule set", () => {
    expect(() => assertRulesWellFormed([
      { id: "r1", attribute: "age", op: "gte", value: 18, effect: "disqualify" },
    ])).not.toThrow();
  });
  it("throws for non-array", () => {
    expect(() => assertRulesWellFormed("bad")).toThrow("RULES_NOT_ARRAY");
  });
  it("throws for missing rule ID", () => {
    expect(() => assertRulesWellFormed([{ id: "", attribute: "x", op: "eq", effect: "disqualify" }])).toThrow("RULE_MISSING_ID");
  });
  it("throws for duplicate IDs", () => {
    expect(() => assertRulesWellFormed([
      { id: "r1", attribute: "x", op: "eq", effect: "disqualify" },
      { id: "r1", attribute: "y", op: "eq", effect: "disqualify" },
    ])).toThrow("RULE_DUPLICATE_ID");
  });
  it("throws for invalid operator", () => {
    expect(() => assertRulesWellFormed([{ id: "r1", attribute: "x", op: "like", effect: "disqualify" }])).toThrow("RULE_BAD_OP");
  });
  it("throws for in/nin without array value", () => {
    expect(() => assertRulesWellFormed([{ id: "r1", attribute: "x", op: "in", value: "bad", effect: "disqualify" }])).toThrow("RULE_OP_NEEDS_ARRAY");
  });
});
