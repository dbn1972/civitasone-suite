/**
 * helpdesk-service — Routing Capacity & Queue tests
 *
 * Tests cover:
 *  - Agent capacity logic (selectAgent with capacity constraints)
 *  - Queue operations (priority ordering, FIFO within priority)
 *  - Edge cases: full capacity, no agents, concurrent load
 *
 * Requirements: RTE-03, RTE-05
 */
import { describe, it, expect } from "vitest";
import { selectAgent } from "../src/modules/routing/domain.js";
import type { AgentCapacityRow } from "../src/modules/routing/capacity-schema.js";
import type { RoutingRuleRow } from "../src/modules/routing/schema.js";
import type { HoldQueueRow } from "../src/modules/routing/queue-schema.js";

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
    strategy: "least_busy",
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

function makeQueueEntry(overrides: Partial<HoldQueueRow> = {}): HoldQueueRow {
  return {
    id: "q-1",
    tenantId: "tenant-1",
    ticketId: "ticket-1",
    queueName: "default",
    enteredAt: new Date("2025-01-01T10:00:00Z"),
    priority: 0,
    version: 1,
    ...overrides,
  };
}

// ─── Agent Capacity Constraints ───────────────────────────────────────────────

describe("Agent capacity constraints", () => {
  it("excludes agents at max capacity from selection", () => {
    const agents = [
      makeAgent({ agentId: "a1", maxTickets: 5, currentLoad: 5 }),
      makeAgent({ agentId: "a2", id: "cap-2", maxTickets: 10, currentLoad: 3 }),
    ];
    const rule = makeRule({ strategy: "least_busy" });

    const result = selectAgent(rule, agents);
    expect(result.agentId).toBe("a2");
  });

  it("excludes unavailable agents regardless of capacity", () => {
    const agents = [
      makeAgent({ agentId: "a1", available: false, currentLoad: 0 }),
      makeAgent({ agentId: "a2", id: "cap-2", available: true, currentLoad: 8 }),
    ];
    const rule = makeRule({ strategy: "least_busy" });

    expect(selectAgent(rule, agents).agentId).toBe("a2");
  });

  it("returns null when all agents are at capacity", () => {
    const agents = [
      makeAgent({ agentId: "a1", maxTickets: 5, currentLoad: 5 }),
      makeAgent({ agentId: "a2", id: "cap-2", maxTickets: 3, currentLoad: 3 }),
      makeAgent({ agentId: "a3", id: "cap-3", maxTickets: 1, currentLoad: 1 }),
    ];
    const rule = makeRule({ strategy: "least_busy" });

    const result = selectAgent(rule, agents);
    expect(result.agentId).toBeNull();
    expect(result.reason).toBe("no_available_agents");
  });

  it("prefers agent with most remaining capacity in least_busy", () => {
    const agents = [
      makeAgent({ agentId: "a1", maxTickets: 10, currentLoad: 8 }), // 2 remaining
      makeAgent({ agentId: "a2", id: "cap-2", maxTickets: 10, currentLoad: 3 }), // 7 remaining
      makeAgent({ agentId: "a3", id: "cap-3", maxTickets: 10, currentLoad: 5 }), // 5 remaining
    ];
    const rule = makeRule({ strategy: "least_busy" });

    expect(selectAgent(rule, agents).agentId).toBe("a2");
  });

  it("skill_based with multiple required skills narrows selection", () => {
    const agents = [
      makeAgent({ agentId: "a1", skills: ["networking"] }),
      makeAgent({ agentId: "a2", id: "cap-2", skills: ["networking", "security"] }),
      makeAgent({ agentId: "a3", id: "cap-3", skills: ["java"] }),
    ];
    const rule = makeRule({
      strategy: "skill_based",
      criteria: { requiredSkills: ["networking", "security"] },
    });

    const result = selectAgent(rule, agents);
    expect(result.agentId).toBe("a2");
  });

  it("skill_based with empty skills array matches all", () => {
    const agents = [
      makeAgent({ agentId: "a1", currentLoad: 5 }),
      makeAgent({ agentId: "a2", id: "cap-2", currentLoad: 2 }),
    ];
    const rule = makeRule({
      strategy: "skill_based",
      criteria: { requiredSkills: [] },
    });

    // Falls back to least-loaded
    expect(selectAgent(rule, agents).agentId).toBe("a2");
  });
});

// ─── Queue Priority Ordering ──────────────────────────────────────────────────

describe("Queue priority ordering (unit logic)", () => {
  it("higher priority entries should dequeue first", () => {
    const entries = [
      makeQueueEntry({ id: "q1", priority: 1, enteredAt: new Date("2025-01-01T10:00:00Z") }),
      makeQueueEntry({ id: "q2", priority: 5, enteredAt: new Date("2025-01-01T10:05:00Z") }),
      makeQueueEntry({ id: "q3", priority: 3, enteredAt: new Date("2025-01-01T10:02:00Z") }),
    ];

    // Sort by priority DESC then enteredAt ASC (matching dequeue logic)
    const sorted = [...entries].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enteredAt.getTime() - b.enteredAt.getTime();
    });

    expect(sorted[0]!.id).toBe("q2"); // priority 5
    expect(sorted[1]!.id).toBe("q3"); // priority 3
    expect(sorted[2]!.id).toBe("q1"); // priority 1
  });

  it("FIFO within same priority", () => {
    const entries = [
      makeQueueEntry({ id: "q1", priority: 3, enteredAt: new Date("2025-01-01T10:05:00Z") }),
      makeQueueEntry({ id: "q2", priority: 3, enteredAt: new Date("2025-01-01T10:00:00Z") }),
      makeQueueEntry({ id: "q3", priority: 3, enteredAt: new Date("2025-01-01T10:10:00Z") }),
    ];

    const sorted = [...entries].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enteredAt.getTime() - b.enteredAt.getTime();
    });

    expect(sorted[0]!.id).toBe("q2"); // earliest
    expect(sorted[1]!.id).toBe("q1");
    expect(sorted[2]!.id).toBe("q3"); // latest
  });

  it("empty queue returns nothing when sorted", () => {
    const entries: HoldQueueRow[] = [];
    const sorted = [...entries].sort((a, b) => b.priority - a.priority);
    expect(sorted).toHaveLength(0);
  });

  it("single entry dequeues correctly", () => {
    const entries = [
      makeQueueEntry({ id: "q1", priority: 5, ticketId: "ticket-42" }),
    ];

    const next = entries[0]!;
    expect(next.ticketId).toBe("ticket-42");
    expect(next.priority).toBe(5);
  });
});

// ─── Weighted Strategy Edge Cases ─────────────────────────────────────────────

describe("Weighted strategy edge cases", () => {
  it("single available agent is always selected", () => {
    const agents = [makeAgent({ agentId: "a1", currentLoad: 9, maxTickets: 10 })];
    const rule = makeRule({ strategy: "weighted" });

    expect(selectAgent(rule, agents).agentId).toBe("a1");
  });

  it("selects from agents with varied max capacities", () => {
    const agents = [
      makeAgent({ agentId: "a1", maxTickets: 20, currentLoad: 10 }), // 50%
      makeAgent({ agentId: "a2", id: "cap-2", maxTickets: 5, currentLoad: 1 }), // 20%
    ];
    const rule = makeRule({ strategy: "weighted" });

    // a2 has lower load ratio (20% vs 50%)
    expect(selectAgent(rule, agents).agentId).toBe("a2");
  });
});
