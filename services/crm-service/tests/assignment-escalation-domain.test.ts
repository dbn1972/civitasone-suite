/**
 * CRM Assignment — lead escalation domain tests.
 * Pack #05. Source: modules/assignment/escalation-domain.ts
 */
import { describe, it, expect } from "vitest";
import { evaluateLead, findOverdue, type EscalationRuleLike, type LeadTimingLike } from "../src/modules/assignment/escalation-domain.js";

const NOW = new Date("2026-07-15T12:00:00Z");

const RULE_UNACCEPTED: EscalationRuleLike = {
  id: "r1", trigger: "unaccepted", thresholdMinutes: 60, reassign: true, enabled: true, recipientRole: "manager", recipientId: null,
};

const RULE_UNATTENDED: EscalationRuleLike = {
  id: "r2", trigger: "unattended", thresholdMinutes: 120, reassign: false, enabled: true, recipientRole: null, recipientId: "sup-001",
};

describe("evaluateLead — unaccepted trigger", () => {
  it("escalates when assigned > threshold and not accepted", () => {
    const lead: LeadTimingLike = { leadId: "L1", ownerId: "O1", assignedAt: "2026-07-15T10:00:00Z", acceptedAt: null, lastActivityAt: null };
    const result = evaluateLead(lead, RULE_UNACCEPTED, NOW);
    expect(result).not.toBeNull();
    expect(result!.trigger).toBe("unaccepted");
    expect(result!.ageingMinutes).toBe(120);
    expect(result!.overdueMinutes).toBe(60);
    expect(result!.reassign).toBe(true);
  });

  it("does NOT escalate when already accepted", () => {
    const lead: LeadTimingLike = { leadId: "L1", ownerId: "O1", assignedAt: "2026-07-15T10:00:00Z", acceptedAt: "2026-07-15T10:30:00Z", lastActivityAt: null };
    expect(evaluateLead(lead, RULE_UNACCEPTED, NOW)).toBeNull();
  });

  it("does NOT escalate when within threshold", () => {
    const lead: LeadTimingLike = { leadId: "L1", ownerId: "O1", assignedAt: "2026-07-15T11:30:00Z", acceptedAt: null, lastActivityAt: null };
    expect(evaluateLead(lead, RULE_UNACCEPTED, NOW)).toBeNull(); // only 30 min
  });

  it("does NOT escalate when never assigned", () => {
    const lead: LeadTimingLike = { leadId: "L1", ownerId: null, assignedAt: null, acceptedAt: null, lastActivityAt: null };
    expect(evaluateLead(lead, RULE_UNACCEPTED, NOW)).toBeNull();
  });
});

describe("evaluateLead — unattended trigger", () => {
  it("escalates based on lastActivityAt", () => {
    const lead: LeadTimingLike = { leadId: "L2", ownerId: "O1", assignedAt: "2026-07-10T00:00:00Z", acceptedAt: "2026-07-10T01:00:00Z", lastActivityAt: "2026-07-15T09:00:00Z" };
    const result = evaluateLead(lead, RULE_UNATTENDED, NOW);
    expect(result).not.toBeNull();
    expect(result!.trigger).toBe("unattended");
    expect(result!.ageingMinutes).toBe(180); // 3h from last activity
    expect(result!.overdueMinutes).toBe(60); // 180 - 120 threshold
  });

  it("falls back to assignedAt when no activity", () => {
    const lead: LeadTimingLike = { leadId: "L3", ownerId: "O1", assignedAt: "2026-07-15T09:00:00Z", acceptedAt: "2026-07-15T09:05:00Z", lastActivityAt: null };
    const result = evaluateLead(lead, RULE_UNATTENDED, NOW);
    expect(result).not.toBeNull();
    expect(result!.ageingMinutes).toBe(180); // from assignedAt
  });
});

describe("findOverdue — first matching rule per lead", () => {
  it("stops at first matching rule", () => {
    const leads: LeadTimingLike[] = [{ leadId: "L1", ownerId: "O1", assignedAt: "2026-07-15T09:00:00Z", acceptedAt: null, lastActivityAt: null }];
    const rules = [RULE_UNACCEPTED, RULE_UNATTENDED]; // unaccepted matches first
    const results = findOverdue(leads, rules, NOW);
    expect(results.length).toBe(1);
    expect(results[0]!.ruleId).toBe("r1");
  });

  it("returns empty when no leads are overdue", () => {
    const leads: LeadTimingLike[] = [{ leadId: "L1", ownerId: "O1", assignedAt: "2026-07-15T11:30:00Z", acceptedAt: null, lastActivityAt: null }];
    expect(findOverdue(leads, [RULE_UNACCEPTED], NOW).length).toBe(0);
  });
});
