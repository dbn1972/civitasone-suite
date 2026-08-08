/**
 * Helpdesk Service — SLA Domain: Deep test suite.
 *
 * Tests deadline computation, at-risk/breach detection, CSAT validation,
 * policy resolution with fallback, and boundary conditions.
 *
 * Source: modules/sla/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  computeDeadlines,
  isAtRisk,
  isBreached,
  evaluateSlaStatus,
  isValidCsatRating,
  isCsatWindowOpen,
  isCsatDetractor,
  CSAT_DETRACTOR_MAX_RATING,
  DEFAULT_SLA_POLICIES,
  resolvePolicy,
  type SlaPolicy,
} from "../src/modules/sla/domain.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";

function policy(opts: Partial<SlaPolicy> = {}): SlaPolicy {
  return {
    id: "pol-1", tenantId: TENANT, priority: "high",
    category: null, responseMinutes: 60, resolutionMinutes: 480,
    ...opts,
  };
}

describe("computeDeadlines", () => {
  it("adds responseMinutes and resolutionMinutes to createdAt", () => {
    const created = new Date("2026-07-01T10:00:00Z");
    const p = policy({ responseMinutes: 60, resolutionMinutes: 480 });
    const { responseDeadline, resolutionDeadline } = computeDeadlines(created, p);
    expect(responseDeadline.toISOString()).toBe("2026-07-01T11:00:00.000Z"); // +60m
    expect(resolutionDeadline.toISOString()).toBe("2026-07-01T18:00:00.000Z"); // +8h
  });

  it("handles critical SLA (30 min response, 4h resolution)", () => {
    const created = new Date("2026-07-01T09:00:00Z");
    const p = policy({ priority: "critical", responseMinutes: 30, resolutionMinutes: 240 });
    const { responseDeadline, resolutionDeadline } = computeDeadlines(created, p);
    expect(responseDeadline.toISOString()).toBe("2026-07-01T09:30:00.000Z");
    expect(resolutionDeadline.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("handles midnight crossover", () => {
    const created = new Date("2026-07-01T23:00:00Z");
    const p = policy({ resolutionMinutes: 120 }); // 2 hours
    const { resolutionDeadline } = computeDeadlines(created, p);
    expect(resolutionDeadline.toISOString()).toBe("2026-07-02T01:00:00.000Z");
  });
});

describe("isAtRisk — 80% threshold detection", () => {
  const created = new Date("2026-07-01T10:00:00Z");
  const deadline = new Date("2026-07-01T18:00:00Z"); // 8h window

  it("returns false at 0% elapsed", () => {
    expect(isAtRisk(created, created, deadline)).toBe(false);
  });

  it("returns false at 50% elapsed", () => {
    const now = new Date("2026-07-01T14:00:00Z"); // 4h of 8h
    expect(isAtRisk(now, created, deadline)).toBe(false);
  });

  it("returns false at 79% elapsed", () => {
    // 79% of 480min = 379.2min → 6h19m12s after 10:00 = 16:19:12
    const now = new Date("2026-07-01T16:19:00Z");
    expect(isAtRisk(now, created, deadline)).toBe(false);
  });

  it("returns true at 80% elapsed (threshold)", () => {
    // 80% of 480min = 384min → 6h24m after 10:00 = 16:24:00
    const now = new Date("2026-07-01T16:24:00Z");
    expect(isAtRisk(now, created, deadline)).toBe(true);
  });

  it("returns true at 90% elapsed", () => {
    // 90% of 480min = 432min → 7h12m
    const now = new Date("2026-07-01T17:12:00Z");
    expect(isAtRisk(now, created, deadline)).toBe(true);
  });

  it("returns false when breached (at 100%)", () => {
    // At deadline exactly — classified as breached, not at-risk
    expect(isAtRisk(deadline, created, deadline)).toBe(false);
  });

  it("returns false for zero-window (deadline = created)", () => {
    expect(isAtRisk(created, created, created)).toBe(false);
  });
});

describe("isBreached — deadline exceeded", () => {
  const deadline = new Date("2026-07-01T18:00:00Z");

  it("returns false before deadline", () => {
    expect(isBreached(new Date("2026-07-01T17:59:59Z"), deadline)).toBe(false);
  });

  it("returns true at exact deadline", () => {
    expect(isBreached(deadline, deadline)).toBe(true);
  });

  it("returns true after deadline", () => {
    expect(isBreached(new Date("2026-07-01T18:00:01Z"), deadline)).toBe(true);
  });
});

describe("evaluateSlaStatus — composite evaluation", () => {
  const created = new Date("2026-07-01T10:00:00Z");
  const p = policy({ resolutionMinutes: 480 }); // 8h window

  it("within_sla at start", () => {
    const result = evaluateSlaStatus(created, created, p);
    expect(result.status).toBe("within_sla");
  });

  it("at_risk at 85%", () => {
    // 85% of 480 = 408 min = 6h48m → 16:48
    const now = new Date("2026-07-01T16:48:00Z");
    const result = evaluateSlaStatus(now, created, p);
    expect(result.status).toBe("at_risk");
  });

  it("breached after deadline", () => {
    const now = new Date("2026-07-01T19:00:00Z");
    const result = evaluateSlaStatus(now, created, p);
    expect(result.status).toBe("breached");
  });

  it("returns correct deadlines", () => {
    const result = evaluateSlaStatus(created, created, p);
    expect(result.deadlines.resolutionDeadline.toISOString()).toBe("2026-07-01T18:00:00.000Z");
  });
});

describe("isValidCsatRating", () => {
  it("accepts 1-5", () => {
    for (let i = 1; i <= 5; i++) expect(isValidCsatRating(i)).toBe(true);
  });
  it("rejects 0", () => expect(isValidCsatRating(0)).toBe(false));
  it("rejects 6", () => expect(isValidCsatRating(6)).toBe(false));
  it("rejects non-integer", () => expect(isValidCsatRating(3.5)).toBe(false));
  it("rejects negative", () => expect(isValidCsatRating(-1)).toBe(false));
});

describe("isCsatWindowOpen — 15 minute survey window", () => {
  const resolved = new Date("2026-07-01T15:00:00Z");

  it("open immediately after resolution", () => {
    expect(isCsatWindowOpen(resolved, resolved)).toBe(true);
  });

  it("open at 14 minutes", () => {
    expect(isCsatWindowOpen(resolved, new Date("2026-07-01T15:14:00Z"))).toBe(true);
  });

  it("open at exactly 15 minutes", () => {
    expect(isCsatWindowOpen(resolved, new Date("2026-07-01T15:15:00Z"))).toBe(true);
  });

  it("closed after 15 minutes", () => {
    expect(isCsatWindowOpen(resolved, new Date("2026-07-01T15:15:01Z"))).toBe(false);
  });

  it("closed before resolution (time travel)", () => {
    expect(isCsatWindowOpen(resolved, new Date("2026-07-01T14:59:59Z"))).toBe(false);
  });
});

describe("isCsatDetractor — service recovery trigger", () => {
  it("CSAT_DETRACTOR_MAX_RATING is 2", () => {
    expect(CSAT_DETRACTOR_MAX_RATING).toBe(2);
  });
  it("rating 1 is detractor", () => expect(isCsatDetractor(1)).toBe(true));
  it("rating 2 is detractor", () => expect(isCsatDetractor(2)).toBe(true));
  it("rating 3 is NOT detractor", () => expect(isCsatDetractor(3)).toBe(false));
  it("invalid rating is NOT detractor", () => expect(isCsatDetractor(0)).toBe(false));
});

describe("DEFAULT_SLA_POLICIES", () => {
  it("has 4 default policies (critical, high, medium, low)", () => {
    expect(DEFAULT_SLA_POLICIES).toHaveLength(4);
  });

  it("critical has fastest response (30 min)", () => {
    const critical = DEFAULT_SLA_POLICIES.find(p => p.priority === "critical");
    expect(critical?.responseMinutes).toBe(30);
    expect(critical?.resolutionMinutes).toBe(240);
  });

  it("low has slowest response (480 min)", () => {
    const low = DEFAULT_SLA_POLICIES.find(p => p.priority === "low");
    expect(low?.responseMinutes).toBe(480);
    expect(low?.resolutionMinutes).toBe(2880);
  });

  it("all have null category (apply to all categories)", () => {
    expect(DEFAULT_SLA_POLICIES.every(p => p.category === null)).toBe(true);
  });
});

describe("resolvePolicy — policy matching with fallback", () => {
  const policies: SlaPolicy[] = [
    policy({ id: "p1", priority: "high", category: "billing", responseMinutes: 30, resolutionMinutes: 120 }),
    policy({ id: "p2", priority: "high", category: null, responseMinutes: 60, resolutionMinutes: 480 }),
    policy({ id: "p3", priority: "low", category: null, responseMinutes: 480, resolutionMinutes: 2880 }),
  ];

  it("matches exact priority + category", () => {
    const result = resolvePolicy(policies, "high", "billing");
    expect(result?.id).toBe("p1");
  });

  it("falls back to priority-only when category not matched", () => {
    const result = resolvePolicy(policies, "high", "network");
    expect(result?.id).toBe("p2");
  });

  it("matches priority-only directly when no category supplied", () => {
    const result = resolvePolicy(policies, "high", null);
    expect(result?.id).toBe("p2");
  });

  it("returns null when no matching priority", () => {
    const result = resolvePolicy(policies, "critical", null);
    expect(result).toBeNull();
  });

  it("is case-insensitive on priority", () => {
    const result = resolvePolicy(policies, "HIGH", null);
    expect(result?.id).toBe("p2");
  });

  it("is case-insensitive on category", () => {
    const result = resolvePolicy(policies, "high", "BILLING");
    expect(result?.id).toBe("p1");
  });
});
