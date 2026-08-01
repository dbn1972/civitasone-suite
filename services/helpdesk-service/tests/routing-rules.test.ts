/**
 * helpdesk-service — Routing Rules tests
 *
 * Tests cover:
 *  - selectAgent (round_robin, weighted, skill_based, least_busy)
 *  - validateRulePrecedence
 *  - detectConflicts
 *  - isValidStrategy
 *
 * Requirements: RTE-02, RTE-07
 */
import { describe, it, expect } from "vitest";
import {
  selectAgent,
  validateRulePrecedence,
  detectConflicts,
  isValidStrategy,
  VALID_STRATEGIES,
  type RoutingStrategy,
} from "../src/modules/routing/domain.js";
import type { AgentCapacityRow } from "../src/modules/routing/capacity-schema.js";
import type { RoutingRuleRow } from "../src/modules/routing/schema.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentCapacityRow> = {}): AgentCapacityRow {
  return {
    id: "agent-cap-1",
    tenantId: "tenant-1",
    agentId: "agent-1",
    maxTickets: 10,
    currentLoad: 0,
    skills: [],
    available: true,
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

function makeRule(overrides: Partial<RoutingRuleRow> = {}): RoutingRuleRow {
  return {
    id: "rule-1",
    tenantId: "tenant-1",
    name: "Default Rule",
    strategy: "round_robin",
    criteria: null,
    weight: 1,
    enabled: true,
    ordinal: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "actor-1",
    version: 1,
    ...overrides,
  };
}

// ─── selectAgent: Round Robin ─────────────────────────────────────────────────

describe("selectAgent — round_robin", () => {
  it("selects the agent at the given index", () => {
    const agents = [
      makeAgent({ agentId: "a1" }),
      makeAgent({ agentId: "a2", id: "cap-2" }),
      makeAgent({ agentId: "a3", id: "cap-3" }),
    ];
    const rule = makeRule({ strategy: "round_robin" });

    expect(selectAgent(rule, agents, 0).agentId).toBe("a1");
    expect(selectAgent(rule, agents, 1).agentId).toBe("a2");
    expect(selectAgent(rule, agents, 2).agentId).toBe("a3");
  });

  it("wraps around when index exceeds agent count", () => {
    const agents = [
      makeAgent({ agentId: "a1" }),
      makeAgent({ agentId: "a2", id: "cap-2" }),
    ];
    const rule = makeRule({ strategy: "round_robin" });

    expect(selectAgent(rule, agents, 4).agentId).toBe("a1");
    expect(selectAgent(rule, agents, 5).agentId).toBe("a2");
  });

  it("skips unavailable agents", () => {
    const agents = [
      makeAgent({ agentId: "a1", available: false }),
      makeAgent({ agentId: "a2", id: "cap-2" }),
    ];
    const rule = makeRule({ strategy: "round_robin" });

    expect(selectAgent(rule, agents, 0).agentId).toBe("a2");
  });

  it("skips agents at max capacity", () => {
    const agents = [
      makeAgent({ agentId: "a1", maxTickets: 5, currentLoad: 5 }),
      makeAgent({ agentId: "a2", id: "cap-2", maxTickets: 5, currentLoad: 3 }),
    ];
    const rule = makeRule({ strategy: "round_robin" });

    expect(selectAgent(rule, agents, 0).agentId).toBe("a2");
  });

  it("returns null when no agents are available", () => {
    const agents = [
      makeAgent({ agentId: "a1", available: false }),
      makeAgent({ agentId: "a2", id: "cap-2", maxTickets: 5, currentLoad: 5 }),
    ];
    const rule = makeRule({ strategy: "round_robin" });

    const result = selectAgent(rule, agents, 0);
    expect(result.agentId).toBeNull();
    expect(result.reason).toBe("no_available_agents");
  });
});

// ─── selectAgent: Weighted ────────────────────────────────────────────────────

describe("selectAgent — weighted (least-loaded ratio)", () => {
  it("selects agent with lowest load ratio", () => {
    const agents = [
      makeAgent({ agentId: "a1", maxTickets: 10, currentLoad: 8 }), // 80%
      makeAgent({ agentId: "a2", id: "cap-2", maxTickets: 10, currentLoad: 2 }), // 20%
      makeAgent({ agentId: "a3", id: "cap-3", maxTickets: 5, currentLoad: 1 }), // 20%
    ];
    const rule = makeRule({ strategy: "weighted" });

    const result = selectAgent(rule, agents);
    // a2 and a3 both at 20%, but a2 comes first in sort stability
    expect(["a2", "a3"]).toContain(result.agentId);
    expect(result.reason).toBe("weighted_least_loaded");
  });
});

// ─── selectAgent: Skill-Based ─────────────────────────────────────────────────

describe("selectAgent — skill_based", () => {
  it("selects agent matching required skills", () => {
    const agents = [
      makeAgent({ agentId: "a1", skills: ["java", "docker"] }),
      makeAgent({ agentId: "a2", id: "cap-2", skills: ["python", "networking"] }),
      makeAgent({ agentId: "a3", id: "cap-3", skills: ["networking", "docker"] }),
    ];
    const rule = makeRule({
      strategy: "skill_based",
      criteria: { requiredSkills: ["networking"] },
    });

    const result = selectAgent(rule, agents);
    expect(["a2", "a3"]).toContain(result.agentId);
    expect(result.reason).toBe("skill_based_matched");
  });

  it("returns null when no agents have required skills", () => {
    const agents = [
      makeAgent({ agentId: "a1", skills: ["java", "docker"] }),
    ];
    const rule = makeRule({
      strategy: "skill_based",
      criteria: { requiredSkills: ["kubernetes"] },
    });

    const result = selectAgent(rule, agents);
    expect(result.agentId).toBeNull();
    expect(result.reason).toBe("no_agents_with_required_skills");
  });

  it("falls back to least loaded when no skills required", () => {
    const agents = [
      makeAgent({ agentId: "a1", currentLoad: 5 }),
      makeAgent({ agentId: "a2", id: "cap-2", currentLoad: 2 }),
    ];
    const rule = makeRule({
      strategy: "skill_based",
      criteria: {},
    });

    expect(selectAgent(rule, agents).agentId).toBe("a2");
  });
});

// ─── selectAgent: Least Busy ──────────────────────────────────────────────────

describe("selectAgent — least_busy", () => {
  it("selects agent with lowest current load", () => {
    const agents = [
      makeAgent({ agentId: "a1", currentLoad: 7 }),
      makeAgent({ agentId: "a2", id: "cap-2", currentLoad: 3 }),
      makeAgent({ agentId: "a3", id: "cap-3", currentLoad: 5 }),
    ];
    const rule = makeRule({ strategy: "least_busy" });

    expect(selectAgent(rule, agents).agentId).toBe("a2");
    expect(selectAgent(rule, agents).reason).toBe("least_busy_selected");
  });

  it("handles empty agent list", () => {
    const rule = makeRule({ strategy: "least_busy" });
    const result = selectAgent(rule, []);
    expect(result.agentId).toBeNull();
    expect(result.reason).toBe("no_available_agents");
  });
});

// ─── validateRulePrecedence ───────────────────────────────────────────────────

describe("validateRulePrecedence", () => {
  it("returns empty for unique ordinals", () => {
    const rules = [
      makeRule({ id: "r1", ordinal: 0, enabled: true }),
      makeRule({ id: "r2", ordinal: 1, enabled: true }),
      makeRule({ id: "r3", ordinal: 2, enabled: true }),
    ];
    expect(validateRulePrecedence(rules)).toHaveLength(0);
  });

  it("detects duplicate ordinals among enabled rules", () => {
    const rules = [
      makeRule({ id: "r1", name: "Rule A", ordinal: 0, enabled: true }),
      makeRule({ id: "r2", name: "Rule B", ordinal: 0, enabled: true }),
    ];
    const issues = validateRulePrecedence(rules);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Rule A");
    expect(issues[0]).toContain("Rule B");
  });

  it("ignores disabled rules", () => {
    const rules = [
      makeRule({ id: "r1", name: "Rule A", ordinal: 0, enabled: true }),
      makeRule({ id: "r2", name: "Rule B", ordinal: 0, enabled: false }),
    ];
    expect(validateRulePrecedence(rules)).toHaveLength(0);
  });
});

// ─── detectConflicts ──────────────────────────────────────────────────────────

describe("detectConflicts", () => {
  it("returns empty for non-overlapping rules", () => {
    const rules = [
      makeRule({ id: "r1", name: "A", criteria: { priority: "high" }, ordinal: 0, enabled: true }),
      makeRule({ id: "r2", name: "B", criteria: { priority: "low" }, ordinal: 1, enabled: true }),
    ];
    expect(detectConflicts(rules)).toHaveLength(0);
  });

  it("detects conflicts for same criteria at same ordinal", () => {
    const rules = [
      makeRule({ id: "r1", name: "A", criteria: { priority: "high" }, ordinal: 0, enabled: true }),
      makeRule({ id: "r2", name: "B", criteria: { priority: "high" }, ordinal: 0, enabled: true }),
    ];
    const conflicts = detectConflicts(rules);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain("ambiguous");
  });

  it("detects conflicts for overlapping criteria at different ordinals", () => {
    const rules = [
      makeRule({ id: "r1", name: "A", criteria: { priority: "high" }, ordinal: 0, enabled: true }),
      makeRule({ id: "r2", name: "B", criteria: { priority: "high" }, ordinal: 1, enabled: true }),
    ];
    const conflicts = detectConflicts(rules);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain("may never execute");
  });

  it("ignores disabled rules", () => {
    const rules = [
      makeRule({ id: "r1", name: "A", criteria: { priority: "high" }, ordinal: 0, enabled: true }),
      makeRule({ id: "r2", name: "B", criteria: { priority: "high" }, ordinal: 0, enabled: false }),
    ];
    expect(detectConflicts(rules)).toHaveLength(0);
  });

  it("considers null criteria as overlapping with everything", () => {
    const rules = [
      makeRule({ id: "r1", name: "A", criteria: null, ordinal: 0, enabled: true }),
      makeRule({ id: "r2", name: "B", criteria: { priority: "high" }, ordinal: 1, enabled: true }),
    ];
    const conflicts = detectConflicts(rules);
    expect(conflicts).toHaveLength(1);
  });
});

// ─── isValidStrategy ──────────────────────────────────────────────────────────

describe("isValidStrategy", () => {
  it("accepts all valid strategies", () => {
    for (const s of VALID_STRATEGIES) {
      expect(isValidStrategy(s)).toBe(true);
    }
  });

  it("rejects unknown strategies", () => {
    expect(isValidStrategy("random")).toBe(false);
    expect(isValidStrategy("")).toBe(false);
    expect(isValidStrategy("ROUND_ROBIN")).toBe(false);
  });
});
