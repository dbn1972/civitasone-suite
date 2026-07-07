/**
 * Unit tests for the lead assignment rules engine.
 *
 * Tests:
 * - Territory match assigns correct owner
 * - Round-robin cycles through roster
 * - Score threshold assigns when score meets threshold
 * - No match → fallback owner
 * - Disabled rules are skipped
 * - Priority ordering (ascending ordinal)
 */
import { describe, it, expect } from "vitest";
import { assignLead } from "../src/modules/leads/assignment.js";
import type { AssignmentRule, Lead } from "../src/modules/leads/assignment.js";

const FALLBACK_OWNER = "fallback-owner-0000-0000-000000000001";

function makeRule(overrides: Partial<AssignmentRule> & Pick<AssignmentRule, "id" | "type" | "criteria" | "ordinal">): AssignmentRule {
  return {
    enabled: true,
    ...overrides,
  };
}

describe("assignLead — territory rules", () => {
  it("assigns owner when lead territory matches rule territory", () => {
    const lead: Lead = { id: "lead-1", territory: "north" };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-1",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-north" },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe("owner-north");
    expect(result.matchedRuleId).toBe("rule-1");
    expect(result.reason).toBe("territory_match:north");
  });

  it("does not match when lead territory differs from rule territory", () => {
    const lead: Lead = { id: "lead-1", territory: "south" };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-1",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-north" },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe(FALLBACK_OWNER);
    expect(result.matchedRuleId).toBeNull();
    expect(result.reason).toBe("no_rule_matched");
  });

  it("does not match when lead has no territory", () => {
    const lead: Lead = { id: "lead-1", territory: null };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-1",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-north" },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe(FALLBACK_OWNER);
    expect(result.matchedRuleId).toBeNull();
  });
});

describe("assignLead — round-robin rules", () => {
  it("assigns next owner in roster cycling from currentIndex", () => {
    const lead: Lead = { id: "lead-1" };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-rr",
        type: "round_robin",
        criteria: { roster: ["owner-a", "owner-b", "owner-c"], currentIndex: 0 },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe("owner-b");
    expect(result.matchedRuleId).toBe("rule-rr");
    expect(result.reason).toBe("round_robin:index_1");
  });

  it("wraps around to start of roster when at the end", () => {
    const lead: Lead = { id: "lead-1" };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-rr",
        type: "round_robin",
        criteria: { roster: ["owner-a", "owner-b", "owner-c"], currentIndex: 2 },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe("owner-a");
    expect(result.matchedRuleId).toBe("rule-rr");
    expect(result.reason).toBe("round_robin:index_0");
  });

  it("does not match when roster is empty", () => {
    const lead: Lead = { id: "lead-1" };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-rr",
        type: "round_robin",
        criteria: { roster: [], currentIndex: 0 },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe(FALLBACK_OWNER);
    expect(result.matchedRuleId).toBeNull();
  });
});

describe("assignLead — score threshold rules", () => {
  it("assigns when lead score meets threshold", () => {
    const lead: Lead = { id: "lead-1", score: 80 };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-score",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-high" },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe("owner-high");
    expect(result.matchedRuleId).toBe("rule-score");
    expect(result.reason).toBe("score_threshold:75");
  });

  it("assigns when lead score exactly equals threshold", () => {
    const lead: Lead = { id: "lead-1", score: 75 };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-score",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-high" },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe("owner-high");
    expect(result.matchedRuleId).toBe("rule-score");
  });

  it("does not match when lead score is below threshold", () => {
    const lead: Lead = { id: "lead-1", score: 50 };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-score",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-high" },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe(FALLBACK_OWNER);
    expect(result.matchedRuleId).toBeNull();
  });

  it("does not match when lead has no score", () => {
    const lead: Lead = { id: "lead-1", score: null };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-score",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-high" },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe(FALLBACK_OWNER);
    expect(result.matchedRuleId).toBeNull();
  });
});

describe("assignLead — fallback owner", () => {
  it("uses fallback when no rules are provided", () => {
    const lead: Lead = { id: "lead-1", territory: "west", score: 90 };

    const result = assignLead(lead, [], FALLBACK_OWNER);

    expect(result.assignedTo).toBe(FALLBACK_OWNER);
    expect(result.matchedRuleId).toBeNull();
    expect(result.reason).toBe("no_rule_matched");
  });

  it("uses fallback when all rules fail to match", () => {
    const lead: Lead = { id: "lead-1", territory: "south", score: 20 };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-1",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-north" },
        ordinal: 1,
      }),
      makeRule({
        id: "rule-2",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-high" },
        ordinal: 2,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe(FALLBACK_OWNER);
    expect(result.matchedRuleId).toBeNull();
    expect(result.reason).toBe("no_rule_matched");
  });
});

describe("assignLead — disabled rules are skipped", () => {
  it("skips disabled rule and evaluates next", () => {
    const lead: Lead = { id: "lead-1", territory: "north", score: 80 };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-disabled",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-disabled" },
        ordinal: 1,
        enabled: false,
      }),
      makeRule({
        id: "rule-active",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-active" },
        ordinal: 2,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe("owner-active");
    expect(result.matchedRuleId).toBe("rule-active");
  });

  it("falls back when only disabled rules exist", () => {
    const lead: Lead = { id: "lead-1", territory: "north" };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-disabled",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-north" },
        ordinal: 1,
        enabled: false,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe(FALLBACK_OWNER);
    expect(result.matchedRuleId).toBeNull();
  });
});

describe("assignLead — priority ordering", () => {
  it("evaluates rules in ascending ordinal order (first match wins)", () => {
    const lead: Lead = { id: "lead-1", territory: "north", score: 90 };
    const rules: AssignmentRule[] = [
      // Higher ordinal (lower priority) — listed first in array
      makeRule({
        id: "rule-score",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-score" },
        ordinal: 10,
      }),
      // Lower ordinal (higher priority) — listed second in array
      makeRule({
        id: "rule-territory",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-territory" },
        ordinal: 1,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    // Territory rule has lower ordinal so it fires first
    expect(result.assignedTo).toBe("owner-territory");
    expect(result.matchedRuleId).toBe("rule-territory");
  });

  it("second rule matches when first rule does not", () => {
    const lead: Lead = { id: "lead-1", territory: "south", score: 90 };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-territory",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-territory" },
        ordinal: 1,
      }),
      makeRule({
        id: "rule-score",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-score" },
        ordinal: 2,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    expect(result.assignedTo).toBe("owner-score");
    expect(result.matchedRuleId).toBe("rule-score");
  });

  it("round-robin rule always matches (catches all leads in its priority position)", () => {
    const lead: Lead = { id: "lead-1" };
    const rules: AssignmentRule[] = [
      makeRule({
        id: "rule-territory",
        type: "territory",
        criteria: { territory: "north", ownerId: "owner-territory" },
        ordinal: 1,
      }),
      makeRule({
        id: "rule-rr",
        type: "round_robin",
        criteria: { roster: ["owner-a", "owner-b"], currentIndex: 0 },
        ordinal: 2,
      }),
      makeRule({
        id: "rule-score",
        type: "score_threshold",
        criteria: { threshold: 75, ownerId: "owner-score" },
        ordinal: 3,
      }),
    ];

    const result = assignLead(lead, rules, FALLBACK_OWNER);

    // Territory doesn't match (no territory on lead), round-robin catches it
    expect(result.assignedTo).toBe("owner-b");
    expect(result.matchedRuleId).toBe("rule-rr");
  });
});
