/**
 * AS-001/AS-003 — pure engine tests for the criteria added on top of the LM-era
 * territory/round_robin/score_threshold set, and for availability exclusion.
 * The original assignment.test.ts still guards the legacy behaviour.
 */
import { describe, it, expect } from "vitest";
import { assignLead, isEligible } from "../src/modules/leads/assignment.js";
import type { AssignmentRule, Lead, AgentAvailability } from "../src/modules/leads/assignment.js";

const FALLBACK = "fallback-owner";

function rule(o: Partial<AssignmentRule> & Pick<AssignmentRule, "id" | "type" | "criteria" | "ordinal">): AssignmentRule {
  return { enabled: true, ...o };
}

function agent(o: Partial<AgentAvailability> & Pick<AgentAvailability, "ownerId">): AgentAvailability {
  return { available: true, onLeave: false, currentLoad: 0, maxLeads: 50, ...o };
}

describe("attribute rules (product / segment / language)", () => {
  it("routes on product match", () => {
    const lead: Lead = { id: "l1", product: "loan" };
    const r = rule({ id: "r", type: "product", criteria: { value: "loan", ownerId: "owner-loan" }, ordinal: 1 });
    const res = assignLead(lead, [r], FALLBACK);
    expect(res.assignedTo).toBe("owner-loan");
    expect(res.reason).toBe("product_match:loan");
  });

  it("routes on segment match", () => {
    const lead: Lead = { id: "l1", segment: "enterprise" };
    const r = rule({ id: "r", type: "segment", criteria: { value: "enterprise", ownerId: "owner-ent" }, ordinal: 1 });
    expect(assignLead(lead, [r], FALLBACK).assignedTo).toBe("owner-ent");
  });

  it("routes on language match", () => {
    const lead: Lead = { id: "l1", language: "hi" };
    const r = rule({ id: "r", type: "language", criteria: { value: "hi", ownerId: "owner-hi" }, ordinal: 1 });
    expect(assignLead(lead, [r], FALLBACK).assignedTo).toBe("owner-hi");
  });

  it("falls back when attribute does not match", () => {
    const lead: Lead = { id: "l1", product: "insurance" };
    const r = rule({ id: "r", type: "product", criteria: { value: "loan", ownerId: "owner-loan" }, ordinal: 1 });
    expect(assignLead(lead, [r], FALLBACK).assignedTo).toBe(FALLBACK);
  });
});

describe("capacity rules", () => {
  it("picks the eligible agent with the most remaining capacity", () => {
    const lead: Lead = { id: "l1" };
    const r = rule({ id: "cap", type: "capacity", criteria: { roster: ["a", "b", "c"] }, ordinal: 1 });
    const agents = [
      agent({ ownerId: "a", currentLoad: 40, maxLeads: 50 }), // 10 free
      agent({ ownerId: "b", currentLoad: 10, maxLeads: 50 }), // 40 free ← winner
      agent({ ownerId: "c", currentLoad: 48, maxLeads: 50 }), // 2 free
    ];
    const res = assignLead(lead, [r], FALLBACK, { agents });
    expect(res.assignedTo).toBe("b");
    expect(res.reason).toBe("capacity_least_loaded");
  });

  it("skips agents at capacity and on leave", () => {
    const lead: Lead = { id: "l1" };
    const r = rule({ id: "cap", type: "capacity", criteria: { roster: ["a", "b"] }, ordinal: 1 });
    const agents = [
      agent({ ownerId: "a", currentLoad: 50, maxLeads: 50 }), // full
      agent({ ownerId: "b", onLeave: true }), // on leave
    ];
    expect(assignLead(lead, [r], FALLBACK, { agents }).assignedTo).toBe(FALLBACK);
  });
});

describe("availability exclusion (AS-003)", () => {
  it("round-robin skips an unavailable agent and lands on the next eligible one", () => {
    const lead: Lead = { id: "l1" };
    const r = rule({ id: "rr", type: "round_robin", criteria: { roster: ["a", "b", "c"], currentIndex: 0 }, ordinal: 1 });
    // Next after index 0 is b (index 1); mark b unavailable ⇒ lands on c (index 2).
    const agents = [agent({ ownerId: "b", available: false })];
    const res = assignLead(lead, [r], FALLBACK, { agents });
    expect(res.assignedTo).toBe("c");
    expect(res.roundRobinIndex).toBe(2);
  });

  it("round-robin excludes on-leave agents", () => {
    const lead: Lead = { id: "l1" };
    const r = rule({ id: "rr", type: "round_robin", criteria: { roster: ["a", "b"], currentIndex: 1 }, ordinal: 1 });
    // Next is a (index 0); a is on leave ⇒ b at capacity ⇒ nobody ⇒ fallback.
    const agents = [agent({ ownerId: "a", onLeave: true }), agent({ ownerId: "b", currentLoad: 50, maxLeads: 50 })];
    expect(assignLead(lead, [r], FALLBACK, { agents }).assignedTo).toBe(FALLBACK);
  });

  it("attribute rule targeting an ineligible owner is skipped in favour of the next rule", () => {
    const lead: Lead = { id: "l1", product: "loan", score: 90 };
    const rules = [
      rule({ id: "p", type: "product", criteria: { value: "loan", ownerId: "busy" }, ordinal: 1 }),
      rule({ id: "s", type: "score_threshold", criteria: { threshold: 80, ownerId: "free" }, ordinal: 2 }),
    ];
    const agents = [agent({ ownerId: "busy", available: false }), agent({ ownerId: "free" })];
    const res = assignLead(lead, rules, FALLBACK, { agents });
    expect(res.assignedTo).toBe("free");
    expect(res.matchedRuleId).toBe("s");
  });

  it("no exclusion is applied when no availability snapshot is provided", () => {
    const lead: Lead = { id: "l1" };
    const r = rule({ id: "rr", type: "round_robin", criteria: { roster: ["a", "b"], currentIndex: 0 }, ordinal: 1 });
    expect(assignLead(lead, [r], FALLBACK).assignedTo).toBe("b");
  });
});

describe("isEligible", () => {
  it("treats an owner absent from the snapshot as eligible", () => {
    expect(isEligible("unknown", new Map())).toBe(true);
  });
  it("null snapshot ⇒ always eligible", () => {
    expect(isEligible("x", null)).toBe(true);
  });
  it("excludes unavailable / on-leave / at-capacity", () => {
    const m = new Map<string, AgentAvailability>([
      ["u", agent({ ownerId: "u", available: false })],
      ["l", agent({ ownerId: "l", onLeave: true })],
      ["c", agent({ ownerId: "c", currentLoad: 5, maxLeads: 5 })],
      ["ok", agent({ ownerId: "ok", currentLoad: 4, maxLeads: 5 })],
    ]);
    expect(isEligible("u", m)).toBe(false);
    expect(isEligible("l", m)).toBe(false);
    expect(isEligible("c", m)).toBe(false);
    expect(isEligible("ok", m)).toBe(true);
  });
});
