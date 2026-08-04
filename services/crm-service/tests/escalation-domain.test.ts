/** AS-004 — pure overdue/ageing maths for lead escalation. */
import { describe, it, expect } from "vitest";
import { evaluateLead, findOverdue } from "../src/modules/assignment/escalation-domain.js";
import type { EscalationRuleLike, LeadTimingLike } from "../src/modules/assignment/escalation-domain.js";

const NOW = new Date("2026-08-04T12:00:00Z");
function minsAgo(m: number): string {
  return new Date(NOW.getTime() - m * 60_000).toISOString();
}

function rule(o: Partial<EscalationRuleLike> & Pick<EscalationRuleLike, "id" | "trigger" | "thresholdMinutes">): EscalationRuleLike {
  return { reassign: false, enabled: true, recipientRole: "manager", recipientId: null, ...o };
}

describe("evaluateLead — unaccepted", () => {
  const r = rule({ id: "r1", trigger: "unaccepted", thresholdMinutes: 30 });

  it("flags an assigned, unaccepted lead past the threshold with ageing details", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(50), acceptedAt: null, lastActivityAt: null };
    const hit = evaluateLead(lead, r, NOW);
    expect(hit).not.toBeNull();
    expect(hit!.ageingMinutes).toBe(50);
    expect(hit!.overdueMinutes).toBe(20);
    expect(hit!.trigger).toBe("unaccepted");
    expect(hit!.recipientRole).toBe("manager");
  });

  it("does not flag a lead that was already accepted", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(50), acceptedAt: minsAgo(10), lastActivityAt: null };
    expect(evaluateLead(lead, r, NOW)).toBeNull();
  });

  it("does not flag before the threshold is reached", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(20), acceptedAt: null, lastActivityAt: null };
    expect(evaluateLead(lead, r, NOW)).toBeNull();
  });

  it("does not flag a lead that was never assigned", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: null, assignedAt: null, acceptedAt: null, lastActivityAt: null };
    expect(evaluateLead(lead, r, NOW)).toBeNull();
  });
});

describe("evaluateLead — unattended", () => {
  const r = rule({ id: "r2", trigger: "unattended", thresholdMinutes: 60 });

  it("measures from last activity when present", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(500), acceptedAt: minsAgo(400), lastActivityAt: minsAgo(90) };
    const hit = evaluateLead(lead, r, NOW);
    expect(hit!.ageingMinutes).toBe(90);
    expect(hit!.overdueMinutes).toBe(30);
  });

  it("falls back to assigned_at when the lead has no activity", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(75), acceptedAt: null, lastActivityAt: null };
    expect(evaluateLead(lead, r, NOW)!.ageingMinutes).toBe(75);
  });

  it("is quiet when recent activity keeps the lead warm", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(500), acceptedAt: null, lastActivityAt: minsAgo(10) };
    expect(evaluateLead(lead, r, NOW)).toBeNull();
  });
});

describe("evaluateLead — guards", () => {
  it("ignores disabled rules", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(500), acceptedAt: null, lastActivityAt: null };
    expect(evaluateLead(lead, rule({ id: "r", trigger: "unaccepted", thresholdMinutes: 30, enabled: false }), NOW)).toBeNull();
  });
  it("ignores non-positive thresholds", () => {
    const lead: LeadTimingLike = { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(500), acceptedAt: null, lastActivityAt: null };
    expect(evaluateLead(lead, rule({ id: "r", trigger: "unaccepted", thresholdMinutes: 0 }), NOW)).toBeNull();
  });
});

describe("findOverdue", () => {
  it("returns one hit per lead, first matching rule wins", () => {
    const leads: LeadTimingLike[] = [
      { leadId: "l1", ownerId: "o1", assignedAt: minsAgo(120), acceptedAt: null, lastActivityAt: null },
      { leadId: "l2", ownerId: "o2", assignedAt: minsAgo(5), acceptedAt: null, lastActivityAt: null },
    ];
    const rules = [
      rule({ id: "tight", trigger: "unaccepted", thresholdMinutes: 15 }),
      rule({ id: "loose", trigger: "unaccepted", thresholdMinutes: 60 }),
    ];
    const out = findOverdue(leads, rules, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.leadId).toBe("l1");
    expect(out[0]!.ruleId).toBe("tight");
  });
});
