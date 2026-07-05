/**
 * Unit tests for evaluateDecisionTable (src/modules/decisions/domain.ts).
 * Pure logic, no DB. Covers all hit policies: FIRST, COLLECT, UNIQUE.
 */
import { describe, it, expect } from "vitest";
import { evaluateDecisionTable, type DecisionTableDef, type EvalResult } from "../src/modules/decisions/domain.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildTable(overrides: Partial<DecisionTableDef> = {}): DecisionTableDef {
  return {
    hitPolicy: "first",
    inputs: [
      { key: "amount", label: "Amount", type: "number" },
      { key: "category", label: "Category", type: "string" },
    ],
    outputs: [
      { key: "approvalLevel", label: "Approval Level", type: "string" },
    ],
    rules: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FIRST hit policy
// ---------------------------------------------------------------------------
describe("evaluateDecisionTable — FIRST hit policy", () => {
  it("returns the first matching rule when multiple match", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { amount: "> 100000" }, outputs: { approvalLevel: "CFO" } },
        { inputs: { amount: "> 50000" }, outputs: { approvalLevel: "Director" } },
        { inputs: { amount: "> 10000" }, outputs: { approvalLevel: "Manager" } },
      ],
    });
    // amount=75000 matches rules 1 (>50000) and 2 (>10000), first matching wins
    const result = evaluateDecisionTable(table, { amount: 75000, category: "goods" });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("Director");
    expect(result.matchedRules).toEqual([1]);
  });

  it("returns the correct rule based on order (first wins)", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { amount: "> 50000" }, outputs: { approvalLevel: "Director" } },
        { inputs: { amount: "> 100000" }, outputs: { approvalLevel: "CFO" } },
      ],
    });
    // Both match for 200000, but first rule wins
    const result = evaluateDecisionTable(table, { amount: 200000 });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("Director");
    expect(result.matchedRules).toEqual([0]);
  });

  it("returns defaults when no rules match", () => {
    const table = buildTable({
      hitPolicy: "first",
      outputs: [{ key: "approvalLevel", label: "Approval Level", type: "string", defaultValue: "self" }],
      rules: [
        { inputs: { amount: "> 100000" }, outputs: { approvalLevel: "CFO" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 500 });
    expect(result.matched).toBe(false);
    expect(result.outputs.approvalLevel).toBe("self");
    expect(result.matchedRules).toEqual([]);
  });

  it("returns empty outputs when no rules match and no defaults", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { amount: "> 100000" }, outputs: { approvalLevel: "CFO" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 500 });
    expect(result.matched).toBe(false);
    expect(result.outputs).toEqual({});
    expect(result.matchedRules).toEqual([]);
  });

  it("handles empty condition (skip that input check)", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { amount: "", category: "== goods" }, outputs: { approvalLevel: "Clerk" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 100, category: "goods" });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("Clerk");
  });

  it("handles rule with multiple input conditions (all must match)", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { amount: "> 50000", category: "== services" }, outputs: { approvalLevel: "VP" } },
        { inputs: { amount: "> 50000", category: "== goods" }, outputs: { approvalLevel: "Director" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 60000, category: "goods" });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("Director");
    expect(result.matchedRules).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// COLLECT hit policy
// ---------------------------------------------------------------------------
describe("evaluateDecisionTable — COLLECT hit policy", () => {
  it("returns all matching rules merged together", () => {
    const table = buildTable({
      hitPolicy: "collect",
      outputs: [
        { key: "approvalLevel", label: "Approval Level", type: "string" },
        { key: "notifyGroup", label: "Notify Group", type: "string" },
      ],
      rules: [
        { inputs: { amount: "> 50000" }, outputs: { approvalLevel: "Director" } },
        { inputs: { amount: "> 10000" }, outputs: { notifyGroup: "finance-team" } },
        { inputs: { category: "== services" }, outputs: { notifyGroup: "procurement" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 75000, category: "services" });
    expect(result.matched).toBe(true);
    expect(result.matchedRules).toEqual([0, 1, 2]);
    // Last writer wins for overlapping keys (rule 2 overwrites rule 1's notifyGroup)
    expect(result.outputs.approvalLevel).toBe("Director");
    expect(result.outputs.notifyGroup).toBe("procurement");
  });

  it("returns defaults when no rules match", () => {
    const table = buildTable({
      hitPolicy: "collect",
      outputs: [{ key: "approvalLevel", label: "Approval Level", type: "string", defaultValue: "auto" }],
      rules: [
        { inputs: { amount: "> 1000000" }, outputs: { approvalLevel: "CEO" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 100 });
    expect(result.matched).toBe(false);
    expect(result.outputs.approvalLevel).toBe("auto");
    expect(result.matchedRules).toEqual([]);
  });

  it("handles a single matching rule", () => {
    const table = buildTable({
      hitPolicy: "collect",
      rules: [
        { inputs: { amount: "> 1000" }, outputs: { approvalLevel: "Manager" } },
        { inputs: { amount: "> 100000" }, outputs: { approvalLevel: "CFO" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 5000 });
    expect(result.matched).toBe(true);
    expect(result.matchedRules).toEqual([0]);
    expect(result.outputs.approvalLevel).toBe("Manager");
  });
});

// ---------------------------------------------------------------------------
// UNIQUE hit policy
// ---------------------------------------------------------------------------
describe("evaluateDecisionTable — UNIQUE hit policy", () => {
  it("returns the single matching rule when exactly one matches", () => {
    const table = buildTable({
      hitPolicy: "unique",
      rules: [
        { inputs: { amount: "> 100000" }, outputs: { approvalLevel: "CFO" } },
        { inputs: { amount: "<= 100000" }, outputs: { approvalLevel: "Manager" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 50000 });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("Manager");
    expect(result.matchedRules).toEqual([1]);
  });

  it("returns error when multiple rules match", () => {
    const table = buildTable({
      hitPolicy: "unique",
      rules: [
        { inputs: { amount: "> 10000" }, outputs: { approvalLevel: "Director" } },
        { inputs: { amount: "> 50000" }, outputs: { approvalLevel: "CFO" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 75000 });
    expect(result.matched).toBe(false);
    expect(result.outputs).toEqual({});
    expect(result.matchedRules).toEqual([0, 1]);
    expect(result.error).toContain("2 rules matched");
    expect(result.error).toContain("expected exactly 1");
  });

  it("returns error when no rules match", () => {
    const table = buildTable({
      hitPolicy: "unique",
      rules: [
        { inputs: { amount: "> 100000" }, outputs: { approvalLevel: "CFO" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 100 });
    expect(result.matched).toBe(false);
    expect(result.outputs).toEqual({});
    expect(result.matchedRules).toEqual([]);
    expect(result.error).toContain("no rules matched");
  });
});

// ---------------------------------------------------------------------------
// Edge cases & special conditions
// ---------------------------------------------------------------------------
describe("evaluateDecisionTable — edge cases", () => {
  it("handles an empty rule set (no rules)", () => {
    const table = buildTable({ hitPolicy: "first", rules: [] });
    const result = evaluateDecisionTable(table, { amount: 500 });
    expect(result.matched).toBe(false);
  });

  it("handles rules with in-operator conditions", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { category: "in ['goods', 'services']" }, outputs: { approvalLevel: "Standard" } },
        { inputs: { category: "in ['capital']" }, outputs: { approvalLevel: "CFO" } },
      ],
    });
    expect(evaluateDecisionTable(table, { category: "goods" }).outputs.approvalLevel).toBe("Standard");
    expect(evaluateDecisionTable(table, { category: "capital" }).outputs.approvalLevel).toBe("CFO");
    expect(evaluateDecisionTable(table, { category: "unknown" }).matched).toBe(false);
  });

  it("handles equality conditions with strings", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { category: "== 'high'" }, outputs: { approvalLevel: "Director" } },
      ],
    });
    const result = evaluateDecisionTable(table, { category: "high" });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("Director");
  });

  it("handles boolean output values", () => {
    const table: DecisionTableDef = {
      hitPolicy: "first",
      inputs: [{ key: "amount", label: "Amount", type: "number" }],
      outputs: [{ key: "needsAudit", label: "Needs Audit", type: "boolean" }],
      rules: [
        { inputs: { amount: "> 500000" }, outputs: { needsAudit: true } },
        { inputs: { amount: "<= 500000" }, outputs: { needsAudit: false } },
      ],
    };
    expect(evaluateDecisionTable(table, { amount: 1000000 }).outputs.needsAudit).toBe(true);
    expect(evaluateDecisionTable(table, { amount: 1000 }).outputs.needsAudit).toBe(false);
  });

  it("handles context with nested paths", () => {
    const table: DecisionTableDef = {
      hitPolicy: "first",
      inputs: [{ key: "request.priority", label: "Priority", type: "string" }],
      outputs: [{ key: "approvalLevel", label: "Approval Level", type: "string" }],
      rules: [
        { inputs: { "request.priority": "== urgent" }, outputs: { approvalLevel: "immediate" } },
      ],
    };
    const result = evaluateDecisionTable(table, { request: { priority: "urgent" } });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("immediate");
  });

  it("handles multiple outputs per rule", () => {
    const table = buildTable({
      hitPolicy: "first",
      outputs: [
        { key: "approvalLevel", label: "Approval Level", type: "string" },
        { key: "slaHours", label: "SLA Hours", type: "number" },
      ],
      rules: [
        { inputs: { amount: "> 100000" }, outputs: { approvalLevel: "CFO", slaHours: 48 } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 200000 });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("CFO");
    expect(result.outputs.slaHours).toBe(48);
  });

  it("handles less-than (<) condition", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { amount: "< 1000" }, outputs: { approvalLevel: "auto" } },
        { inputs: { amount: ">= 1000" }, outputs: { approvalLevel: "Manager" } },
      ],
    });
    expect(evaluateDecisionTable(table, { amount: 500 }).outputs.approvalLevel).toBe("auto");
    expect(evaluateDecisionTable(table, { amount: 5000 }).outputs.approvalLevel).toBe("Manager");
  });

  it("handles not-equal (!=) condition", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { category: "!= 'goods'" }, outputs: { approvalLevel: "Special" } },
      ],
    });
    expect(evaluateDecisionTable(table, { category: "services" }).matched).toBe(true);
    expect(evaluateDecisionTable(table, { category: "goods" }).matched).toBe(false);
  });

  it("rule with all blank conditions always matches", () => {
    const table = buildTable({
      hitPolicy: "first",
      rules: [
        { inputs: { amount: "  ", category: "" }, outputs: { approvalLevel: "fallback" } },
      ],
    });
    const result = evaluateDecisionTable(table, { amount: 1, category: "anything" });
    expect(result.matched).toBe(true);
    expect(result.outputs.approvalLevel).toBe("fallback");
  });

  it("empty rules array returns no match for COLLECT policy", () => {
    const table = buildTable({
      hitPolicy: "collect",
      outputs: [{ key: "approvalLevel", label: "Approval Level", type: "string", defaultValue: "none" }],
      rules: [],
    });
    const result = evaluateDecisionTable(table, { amount: 500 });
    expect(result.matched).toBe(false);
    expect(result.outputs.approvalLevel).toBe("none");
  });

  it("empty rules array returns error for UNIQUE policy", () => {
    const table = buildTable({ hitPolicy: "unique", rules: [] });
    const result = evaluateDecisionTable(table, { amount: 500 });
    expect(result.matched).toBe(false);
    expect(result.error).toContain("no rules matched");
  });
});
