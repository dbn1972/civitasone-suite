/**
 * Helpdesk Service — SLA engine domain. ~7 packs.
 */
import { describe, it, expect } from "vitest";
import { computeDeadlines, isAtRisk, isBreached, evaluateSlaStatus, resolvePolicy, isValidCsatRating, isCsatDetractor, isCsatWindowOpen, DEFAULT_SLA_POLICIES, type SlaPolicy } from "../src/modules/sla/domain.js";

const POLICY: SlaPolicy = { id: "p1", tenantId: "t1", priority: "high", category: null, responseMinutes: 60, resolutionMinutes: 480 };

describe("SLA computeDeadlines", () => {
  it("adds responseMinutes and resolutionMinutes", () => {
    const d = computeDeadlines(new Date("2026-07-15T10:00:00Z"), POLICY);
    expect(d.responseDeadline.toISOString()).toBe("2026-07-15T11:00:00.000Z");
    expect(d.resolutionDeadline.toISOString()).toBe("2026-07-15T18:00:00.000Z");
  });
});

describe("SLA evaluation", () => {
  it("within_sla: early in window", () => {
    const r = evaluateSlaStatus(new Date("2026-07-15T11:00:00Z"), new Date("2026-07-15T10:00:00Z"), POLICY);
    expect(r.status).toBe("within_sla");
  });
  it("at_risk: 80% elapsed but not breached", () => {
    // 480min total, 80% = 384min after 10:00 = 16:24
    const r = evaluateSlaStatus(new Date("2026-07-15T16:30:00Z"), new Date("2026-07-15T10:00:00Z"), POLICY);
    expect(r.status).toBe("at_risk");
  });
  it("breached: past resolution deadline", () => {
    const r = evaluateSlaStatus(new Date("2026-07-15T19:00:00Z"), new Date("2026-07-15T10:00:00Z"), POLICY);
    expect(r.status).toBe("breached");
  });
});

describe("resolvePolicy", () => {
  const policies: SlaPolicy[] = [
    { id: "1", tenantId: "t1", priority: "high", category: "billing", responseMinutes: 30, resolutionMinutes: 120 },
    { id: "2", tenantId: "t1", priority: "high", category: null, responseMinutes: 60, resolutionMinutes: 480 },
  ];
  it("prefers category-specific match", () => {
    expect(resolvePolicy(policies, "high", "billing")!.id).toBe("1");
  });
  it("falls back to priority-only", () => {
    expect(resolvePolicy(policies, "high", "general")!.id).toBe("2");
  });
  it("null when no match", () => {
    expect(resolvePolicy(policies, "critical", null)).toBeNull();
  });
});

describe("CSAT", () => {
  it("valid rating 1-5", () => { expect(isValidCsatRating(1)).toBe(true); expect(isValidCsatRating(5)).toBe(true); expect(isValidCsatRating(0)).toBe(false); });
  it("detractor: rating <= 2", () => { expect(isCsatDetractor(2)).toBe(true); expect(isCsatDetractor(3)).toBe(false); });
  it("CSAT window: within 15min of resolution", () => {
    const resolved = new Date("2026-07-15T10:00:00Z");
    expect(isCsatWindowOpen(resolved, new Date("2026-07-15T10:10:00Z"))).toBe(true);
    expect(isCsatWindowOpen(resolved, new Date("2026-07-15T10:20:00Z"))).toBe(false);
  });
});

describe("DEFAULT_SLA_POLICIES", () => {
  it("4 default policies (critical/high/medium/low)", () => expect(DEFAULT_SLA_POLICIES.length).toBe(4));
  it("critical response = 30min", () => expect(DEFAULT_SLA_POLICIES[0]!.responseMinutes).toBe(30));
});
