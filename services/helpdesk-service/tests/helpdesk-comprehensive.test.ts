/**
 * Helpdesk Service — Comprehensive Tests (remaining modules).
 *
 * Tests routing (agent selection strategies), automation (rule evaluation,
 * triggers), ticket validators, and ITIL additions.
 *
 * Source: modules/routing/domain.ts, modules/automation/domain.ts, modules/tickets/validators.ts
 */
import { describe, it, expect } from "vitest";
import { selectAgent, VALID_STRATEGIES, type RoutingStrategy } from "../src/modules/routing/domain.js";
import { evaluateRules, type AutomationRule, type TicketForEvaluation } from "../src/modules/automation/domain.js";
import { createTicketBody, assignTicketBody, transitionTicketBody, VALID_CHANNELS } from "../src/modules/tickets/validators.js";

// ═══ ROUTING — Agent Selection ═══

describe("selectAgent — routing strategies", () => {
  const agents = [
    { agentId: "a1", available: true, currentLoad: 2, maxTickets: 10, skills: [] },
    { agentId: "a2", available: true, currentLoad: 5, maxTickets: 10, skills: [] },
    { agentId: "a3", available: false, currentLoad: 0, maxTickets: 10, skills: [] },
    { agentId: "a4", available: true, currentLoad: 10, maxTickets: 10, skills: [] }, // at capacity
  ];

  it("round_robin: selects by index (mod available count)", () => {
    const result = selectAgent({ strategy: "round_robin", criteria: {} }, agents, 0);
    expect(result.agentId).toBe("a1");
    expect(result.reason).toBe("round_robin_selected");
  });

  it("round_robin: wraps around", () => {
    const result = selectAgent({ strategy: "round_robin", criteria: {} }, agents, 1);
    expect(result.agentId).toBe("a2"); // a1, a2 are eligible (a3=unavail, a4=full)
  });

  it("weighted: selects least loaded agent", () => {
    const result = selectAgent({ strategy: "weighted", criteria: {} }, agents, 0);
    expect(result.agentId).toBe("a1"); // load 2/10 < 5/10
    expect(result.reason).toBe("weighted_least_loaded");
  });

  it("returns null when no agents available", () => {
    const noAgents = [{ agentId: "x", available: false, currentLoad: 0, maxTickets: 10, skills: [] }];
    const result = selectAgent({ strategy: "round_robin", criteria: {} }, noAgents, 0);
    expect(result.agentId).toBeNull();
    expect(result.reason).toBe("no_available_agents");
  });

  it("excludes agents at capacity", () => {
    const fullAgents = [{ agentId: "full", available: true, currentLoad: 10, maxTickets: 10, skills: [] }];
    const result = selectAgent({ strategy: "round_robin", criteria: {} }, fullAgents, 0);
    expect(result.agentId).toBeNull();
  });
});

describe("VALID_STRATEGIES", () => {
  it("has 4 strategies", () => expect(VALID_STRATEGIES).toHaveLength(4));
  it("round_robin, weighted, skill_based, least_busy", () => {
    expect([...VALID_STRATEGIES]).toEqual(["round_robin", "weighted", "skill_based", "least_busy"]);
  });
});

// ═══ AUTOMATION — Rule Evaluation ═══

describe("evaluateRules — automation engine", () => {
  const baseTicket: TicketForEvaluation = {
    fields: { priority: "High", category: "network", status: "open" },
    elapsedMinutes: 120,
    subject: "VPN not connecting",
    description: "Cannot access internal resources via VPN",
  };

  const rules: AutomationRule[] = [
    { id: "r1", name: "Critical Escalate", ordinal: 1, enabled: true, trigger: { type: "field_match", field: "priority", value: "Critical" } as any, actions: [{ type: "assign", agentId: "senior" }] as any },
    { id: "r2", name: "High Priority Auto-Assign", ordinal: 2, enabled: true, trigger: { type: "field_match", field: "priority", value: "High" } as any, actions: [{ type: "assign", agentId: "team-lead" }] as any },
    { id: "r3", name: "SLA Warning", ordinal: 3, enabled: true, trigger: { type: "time_elapsed", thresholdMinutes: 60 } as any, actions: [{ type: "notify", target: "supervisor" }] as any },
  ];

  it("matches first rule by ordinal (fire-first-match)", () => {
    const result = evaluateRules(baseTicket, rules);
    expect(result?.ruleId).toBe("r2"); // priority=High matches r2
    expect(result?.ruleName).toBe("High Priority Auto-Assign");
  });

  it("returns null when no rules match", () => {
    const ticket: TicketForEvaluation = { fields: { priority: "Low" }, elapsedMinutes: 5, subject: "Minor issue" };
    const result = evaluateRules(ticket, [rules[0]!]); // only Critical rule
    expect(result).toBeNull();
  });

  it("skips disabled rules", () => {
    const disabled = rules.map(r => ({ ...r, enabled: false }));
    expect(evaluateRules(baseTicket, disabled)).toBeNull();
  });

  it("time_elapsed trigger fires when threshold met", () => {
    const ticket: TicketForEvaluation = { fields: { priority: "Low" }, elapsedMinutes: 120, subject: "Slow issue" };
    const timeRule: AutomationRule = { id: "t1", name: "Time SLA", ordinal: 1, enabled: true, trigger: { type: "time_elapsed", thresholdMinutes: 60 } as any, actions: [] };
    const result = evaluateRules(ticket, [timeRule]);
    expect(result?.ruleId).toBe("t1");
  });

  it("time_elapsed does NOT fire below threshold", () => {
    const ticket: TicketForEvaluation = { fields: {}, elapsedMinutes: 30, subject: "X" };
    const timeRule: AutomationRule = { id: "t1", name: "SLA", ordinal: 1, enabled: true, trigger: { type: "time_elapsed", thresholdMinutes: 60 } as any, actions: [] };
    expect(evaluateRules(ticket, [timeRule])).toBeNull();
  });

  it("keyword_match fires when keyword in subject", () => {
    const kwRule: AutomationRule = { id: "k1", name: "VPN Auto", ordinal: 1, enabled: true, trigger: { type: "keyword_match", keywords: ["vpn", "network"] } as any, actions: [] };
    const result = evaluateRules(baseTicket, [kwRule]);
    expect(result?.ruleId).toBe("k1");
  });

  it("keyword_match is case-insensitive", () => {
    const kwRule: AutomationRule = { id: "k2", name: "KW", ordinal: 1, enabled: true, trigger: { type: "keyword_match", keywords: ["VPN"] } as any, actions: [] };
    const result = evaluateRules(baseTicket, [kwRule]);
    expect(result?.ruleId).toBe("k2");
  });

  it("keyword_match: no match when keywords absent", () => {
    const ticket: TicketForEvaluation = { fields: {}, elapsedMinutes: 0, subject: "Printer broken" };
    const kwRule: AutomationRule = { id: "k3", name: "KW", ordinal: 1, enabled: true, trigger: { type: "keyword_match", keywords: ["vpn"] } as any, actions: [] };
    expect(evaluateRules(ticket, [kwRule])).toBeNull();
  });

  it("respects ordinal ordering (lower ordinal evaluated first)", () => {
    const unordered: AutomationRule[] = [
      { id: "late", name: "Late", ordinal: 10, enabled: true, trigger: { type: "field_match", field: "priority", value: "High" } as any, actions: [{ type: "tag", value: "late" }] as any },
      { id: "early", name: "Early", ordinal: 1, enabled: true, trigger: { type: "field_match", field: "priority", value: "High" } as any, actions: [{ type: "tag", value: "early" }] as any },
    ];
    const result = evaluateRules(baseTicket, unordered);
    expect(result?.ruleId).toBe("early"); // ordinal 1 wins
  });
});

// ═══ TICKET VALIDATORS ═══

describe("createTicketBody — validation boundaries", () => {
  it("accepts minimal valid ticket", () => expect(createTicketBody.safeParse({ subject: "Test" }).success).toBe(true));
  it("rejects empty subject", () => expect(createTicketBody.safeParse({ subject: "" }).success).toBe(false));
  it("rejects missing subject", () => expect(createTicketBody.safeParse({}).success).toBe(false));
  it("accepts all valid priorities", () => {
    for (const p of ["Low", "Medium", "High", "Critical"]) {
      expect(createTicketBody.safeParse({ subject: "X", priority: p }).success).toBe(true);
    }
  });
  it("rejects invalid priority", () => expect(createTicketBody.safeParse({ subject: "X", priority: "Urgent" }).success).toBe(false));
  it("accepts all valid ticket types", () => {
    for (const t of ["incident", "problem", "change"]) {
      expect(createTicketBody.safeParse({ subject: "X", ticketType: t }).success).toBe(true);
    }
  });
  it("rejects invalid ticket type", () => expect(createTicketBody.safeParse({ subject: "X", ticketType: "request" }).success).toBe(false));
  it("VALID_CHANNELS", () => expect([...VALID_CHANNELS]).toEqual(["phone", "email", "portal", "chatbot", "whatsapp", "api", "manual"]));
  it("accepts valid channel", () => expect(createTicketBody.safeParse({ subject: "X", channel: "phone" }).success).toBe(true));
  it("rejects invalid channel", () => expect(createTicketBody.safeParse({ subject: "X", channel: "telegram" }).success).toBe(false));
});

describe("assignTicketBody", () => {
  it("accepts UUID", () => expect(assignTicketBody.safeParse({ assigneeId: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true));
  it("rejects non-UUID", () => expect(assignTicketBody.safeParse({ assigneeId: "bad" }).success).toBe(false));
});

describe("transitionTicketBody", () => {
  it("accepts non-empty status", () => expect(transitionTicketBody.safeParse({ status: "investigating" }).success).toBe(true));
  it("rejects empty status", () => expect(transitionTicketBody.safeParse({ status: "" }).success).toBe(false));
});
