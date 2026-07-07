/**
 * helpdesk-service — SLA Engine + CSAT domain logic tests.
 *
 * Tests cover:
 *  - Deadline computation from policies
 *  - At-risk detection (80% threshold)
 *  - Breach detection
 *  - Fire-once enforcement (sla notified markers)
 *  - CSAT rating validation
 *  - Policy resolution (priority + category matching)
 *
 * Requirements: 12.5, 12.6, 12.7, 12.8
 */
import { describe, it, expect } from "vitest";
import {
  computeDeadlines,
  isAtRisk,
  isBreached,
  evaluateSlaStatus,
  isValidCsatRating,
  isCsatWindowOpen,
  resolvePolicy,
  DEFAULT_SLA_POLICIES,
  type SlaPolicy,
} from "../src/modules/sla/domain.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<SlaPolicy> = {}): SlaPolicy {
  return {
    id: "policy-1",
    tenantId: "tenant-1",
    priority: "high",
    category: null,
    responseMinutes: 60,
    resolutionMinutes: 480,
    ...overrides,
  };
}

function minutesFromNow(baseDate: Date, minutes: number): Date {
  return new Date(baseDate.getTime() + minutes * 60_000);
}

// ─── computeDeadlines ─────────────────────────────────────────────────────────

describe("computeDeadlines", () => {
  it("computes response deadline correctly from policy responseMinutes", () => {
    const createdAt = new Date("2025-01-01T10:00:00Z");
    const policy = makePolicy({ responseMinutes: 60, resolutionMinutes: 480 });

    const { responseDeadline, resolutionDeadline } = computeDeadlines(createdAt, policy);

    expect(responseDeadline).toEqual(new Date("2025-01-01T11:00:00Z")); // +60min
    expect(resolutionDeadline).toEqual(new Date("2025-01-01T18:00:00Z")); // +480min
  });

  it("handles critical priority (30min response, 240min resolution)", () => {
    const createdAt = new Date("2025-06-15T08:00:00Z");
    const policy = makePolicy({ priority: "critical", responseMinutes: 30, resolutionMinutes: 240 });

    const { responseDeadline, resolutionDeadline } = computeDeadlines(createdAt, policy);

    expect(responseDeadline).toEqual(new Date("2025-06-15T08:30:00Z"));
    expect(resolutionDeadline).toEqual(new Date("2025-06-15T12:00:00Z"));
  });

  it("handles low priority (480min response, 2880min resolution)", () => {
    const createdAt = new Date("2025-03-01T00:00:00Z");
    const policy = makePolicy({ priority: "low", responseMinutes: 480, resolutionMinutes: 2880 });

    const { responseDeadline, resolutionDeadline } = computeDeadlines(createdAt, policy);

    expect(responseDeadline).toEqual(new Date("2025-03-01T08:00:00Z")); // +8h
    expect(resolutionDeadline).toEqual(new Date("2025-03-03T00:00:00Z")); // +48h
  });

  it("preserves timezone information in deadlines", () => {
    const createdAt = new Date("2025-07-10T15:30:00.000Z");
    const policy = makePolicy({ responseMinutes: 120 });
    const { responseDeadline } = computeDeadlines(createdAt, policy);
    expect(responseDeadline.toISOString()).toBe("2025-07-10T17:30:00.000Z");
  });
});

// ─── isAtRisk (80% threshold) ─────────────────────────────────────────────────

describe("isAtRisk — 80% of resolution time", () => {
  it("returns false when elapsed < 80% of resolution window", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const resolutionDeadline = new Date("2025-01-01T08:00:00Z"); // 480min window
    const now = minutesFromNow(createdAt, 300); // 62.5% elapsed

    expect(isAtRisk(now, createdAt, resolutionDeadline)).toBe(false);
  });

  it("returns true when elapsed is exactly 80% of resolution window", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const resolutionDeadline = new Date("2025-01-01T08:00:00Z"); // 480min window
    const now = minutesFromNow(createdAt, 384); // exactly 80%

    expect(isAtRisk(now, createdAt, resolutionDeadline)).toBe(true);
  });

  it("returns true when elapsed is between 80% and 100%", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const resolutionDeadline = new Date("2025-01-01T08:00:00Z"); // 480min
    const now = minutesFromNow(createdAt, 450); // 93.75% elapsed

    expect(isAtRisk(now, createdAt, resolutionDeadline)).toBe(true);
  });

  it("returns false when deadline is already breached (>=100%)", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const resolutionDeadline = new Date("2025-01-01T08:00:00Z");
    const now = minutesFromNow(createdAt, 500); // past deadline

    expect(isAtRisk(now, createdAt, resolutionDeadline)).toBe(false);
  });

  it("returns false when resolution window is 0 or negative", () => {
    const createdAt = new Date("2025-01-01T08:00:00Z");
    const resolutionDeadline = new Date("2025-01-01T08:00:00Z"); // 0 window
    const now = createdAt;

    expect(isAtRisk(now, createdAt, resolutionDeadline)).toBe(false);
  });

  it("correctly identifies at-risk for critical priority (240min, 80% = 192min)", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const policy = makePolicy({ priority: "critical", responseMinutes: 30, resolutionMinutes: 240 });
    const deadlines = computeDeadlines(createdAt, policy);

    // At 191 minutes: not at risk yet
    expect(isAtRisk(minutesFromNow(createdAt, 191), createdAt, deadlines.resolutionDeadline)).toBe(false);
    // At 192 minutes: exactly at risk (80%)
    expect(isAtRisk(minutesFromNow(createdAt, 192), createdAt, deadlines.resolutionDeadline)).toBe(true);
    // At 200 minutes: at risk
    expect(isAtRisk(minutesFromNow(createdAt, 200), createdAt, deadlines.resolutionDeadline)).toBe(true);
    // At 240 minutes: breached, not at risk
    expect(isAtRisk(minutesFromNow(createdAt, 240), createdAt, deadlines.resolutionDeadline)).toBe(false);
  });
});

// ─── isBreached ───────────────────────────────────────────────────────────────

describe("isBreached — deadline exceeded", () => {
  it("returns false when now is before the deadline", () => {
    const deadline = new Date("2025-01-01T18:00:00Z");
    const now = new Date("2025-01-01T17:59:59Z");

    expect(isBreached(now, deadline)).toBe(false);
  });

  it("returns true when now equals the deadline exactly", () => {
    const deadline = new Date("2025-01-01T18:00:00Z");
    const now = new Date("2025-01-01T18:00:00Z");

    expect(isBreached(now, deadline)).toBe(true);
  });

  it("returns true when now is after the deadline", () => {
    const deadline = new Date("2025-01-01T18:00:00Z");
    const now = new Date("2025-01-01T19:00:00Z");

    expect(isBreached(now, deadline)).toBe(true);
  });

  it("works correctly with response deadline (short window)", () => {
    const createdAt = new Date("2025-01-01T10:00:00Z");
    const policy = makePolicy({ responseMinutes: 30 });
    const { responseDeadline } = computeDeadlines(createdAt, policy);

    expect(isBreached(minutesFromNow(createdAt, 29), responseDeadline)).toBe(false);
    expect(isBreached(minutesFromNow(createdAt, 30), responseDeadline)).toBe(true);
    expect(isBreached(minutesFromNow(createdAt, 31), responseDeadline)).toBe(true);
  });
});

// ─── evaluateSlaStatus ────────────────────────────────────────────────────────

describe("evaluateSlaStatus — combined status evaluation", () => {
  const createdAt = new Date("2025-01-01T00:00:00Z");
  const policy = makePolicy({ responseMinutes: 60, resolutionMinutes: 480 });

  it("returns within_sla for fresh tickets", () => {
    const now = minutesFromNow(createdAt, 100); // well within window
    const result = evaluateSlaStatus(now, createdAt, policy);
    expect(result.status).toBe("within_sla");
  });

  it("returns at_risk when elapsed reaches 80% of resolution", () => {
    const now = minutesFromNow(createdAt, 390); // 81.25%
    const result = evaluateSlaStatus(now, createdAt, policy);
    expect(result.status).toBe("at_risk");
  });

  it("returns breached when resolution deadline exceeded", () => {
    const now = minutesFromNow(createdAt, 500); // past 480min deadline
    const result = evaluateSlaStatus(now, createdAt, policy);
    expect(result.status).toBe("breached");
  });

  it("returns correct deadlines alongside status", () => {
    const now = minutesFromNow(createdAt, 100);
    const result = evaluateSlaStatus(now, createdAt, policy);
    expect(result.deadlines.responseDeadline).toEqual(new Date("2025-01-01T01:00:00Z"));
    expect(result.deadlines.resolutionDeadline).toEqual(new Date("2025-01-01T08:00:00Z"));
  });
});

// ─── CSAT Validation ──────────────────────────────────────────────────────────

describe("isValidCsatRating", () => {
  it("accepts ratings 1 through 5", () => {
    expect(isValidCsatRating(1)).toBe(true);
    expect(isValidCsatRating(2)).toBe(true);
    expect(isValidCsatRating(3)).toBe(true);
    expect(isValidCsatRating(4)).toBe(true);
    expect(isValidCsatRating(5)).toBe(true);
  });

  it("rejects ratings below 1", () => {
    expect(isValidCsatRating(0)).toBe(false);
    expect(isValidCsatRating(-1)).toBe(false);
  });

  it("rejects ratings above 5", () => {
    expect(isValidCsatRating(6)).toBe(false);
    expect(isValidCsatRating(100)).toBe(false);
  });

  it("rejects non-integer ratings", () => {
    expect(isValidCsatRating(3.5)).toBe(false);
    expect(isValidCsatRating(1.1)).toBe(false);
  });
});

describe("isCsatWindowOpen — within 15 minutes of resolution", () => {
  it("returns true immediately after resolution", () => {
    const resolvedAt = new Date("2025-01-01T10:00:00Z");
    const now = new Date("2025-01-01T10:00:00Z");
    expect(isCsatWindowOpen(resolvedAt, now)).toBe(true);
  });

  it("returns true at 14 minutes after resolution", () => {
    const resolvedAt = new Date("2025-01-01T10:00:00Z");
    const now = new Date("2025-01-01T10:14:00Z");
    expect(isCsatWindowOpen(resolvedAt, now)).toBe(true);
  });

  it("returns true at exactly 15 minutes after resolution", () => {
    const resolvedAt = new Date("2025-01-01T10:00:00Z");
    const now = new Date("2025-01-01T10:15:00Z");
    expect(isCsatWindowOpen(resolvedAt, now)).toBe(true);
  });

  it("returns false after 15 minutes", () => {
    const resolvedAt = new Date("2025-01-01T10:00:00Z");
    const now = new Date("2025-01-01T10:15:01Z");
    expect(isCsatWindowOpen(resolvedAt, now)).toBe(false);
  });

  it("returns false if now is before resolution", () => {
    const resolvedAt = new Date("2025-01-01T10:00:00Z");
    const now = new Date("2025-01-01T09:59:00Z");
    expect(isCsatWindowOpen(resolvedAt, now)).toBe(false);
  });
});

// ─── resolvePolicy ────────────────────────────────────────────────────────────

describe("resolvePolicy — priority + category matching", () => {
  const policies: SlaPolicy[] = [
    makePolicy({ id: "1", priority: "critical", category: null, responseMinutes: 30, resolutionMinutes: 240 }),
    makePolicy({ id: "2", priority: "high", category: null, responseMinutes: 60, resolutionMinutes: 480 }),
    makePolicy({ id: "3", priority: "high", category: "network", responseMinutes: 30, resolutionMinutes: 240 }),
    makePolicy({ id: "4", priority: "medium", category: null, responseMinutes: 240, resolutionMinutes: 1440 }),
    makePolicy({ id: "5", priority: "low", category: null, responseMinutes: 480, resolutionMinutes: 2880 }),
  ];

  it("matches exact priority + category when available", () => {
    const result = resolvePolicy(policies, "high", "network");
    expect(result?.id).toBe("3");
    expect(result?.responseMinutes).toBe(30);
  });

  it("falls back to priority-only when category not matched", () => {
    const result = resolvePolicy(policies, "high", "email");
    expect(result?.id).toBe("2");
    expect(result?.responseMinutes).toBe(60);
  });

  it("falls back to priority-only when no category provided", () => {
    const result = resolvePolicy(policies, "critical", null);
    expect(result?.id).toBe("1");
  });

  it("handles case-insensitive priority matching", () => {
    const result = resolvePolicy(policies, "HIGH", null);
    expect(result?.id).toBe("2");
  });

  it("returns null when no matching policy exists", () => {
    const result = resolvePolicy(policies, "urgent", null);
    expect(result).toBeNull();
  });

  it("returns null for empty policy list", () => {
    const result = resolvePolicy([], "high", null);
    expect(result).toBeNull();
  });
});

// ─── Default Policies ─────────────────────────────────────────────────────────

describe("DEFAULT_SLA_POLICIES", () => {
  it("defines all 4 priorities", () => {
    expect(DEFAULT_SLA_POLICIES).toHaveLength(4);
    const priorities = DEFAULT_SLA_POLICIES.map((p) => p.priority);
    expect(priorities).toContain("critical");
    expect(priorities).toContain("high");
    expect(priorities).toContain("medium");
    expect(priorities).toContain("low");
  });

  it("has escalating response and resolution times by severity", () => {
    const critical = DEFAULT_SLA_POLICIES.find((p) => p.priority === "critical")!;
    const high = DEFAULT_SLA_POLICIES.find((p) => p.priority === "high")!;
    const medium = DEFAULT_SLA_POLICIES.find((p) => p.priority === "medium")!;
    const low = DEFAULT_SLA_POLICIES.find((p) => p.priority === "low")!;

    // Response time increases with decreasing severity
    expect(critical.responseMinutes).toBeLessThan(high.responseMinutes);
    expect(high.responseMinutes).toBeLessThan(medium.responseMinutes);
    expect(medium.responseMinutes).toBeLessThan(low.responseMinutes);

    // Resolution time increases with decreasing severity
    expect(critical.resolutionMinutes).toBeLessThan(high.resolutionMinutes);
    expect(high.resolutionMinutes).toBeLessThan(medium.resolutionMinutes);
    expect(medium.resolutionMinutes).toBeLessThan(low.resolutionMinutes);
  });
});

// ─── Integration: Policy → Deadline → Status ─────────────────────────────────

describe("End-to-end SLA evaluation flow", () => {
  it("critical ticket: at-risk at 192min, breached at 240min", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const policy = makePolicy({ priority: "critical", responseMinutes: 30, resolutionMinutes: 240 });

    // Fresh: within_sla
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 0), createdAt, policy).status).toBe("within_sla");
    // At 191min: within_sla (just under 80%)
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 191), createdAt, policy).status).toBe("within_sla");
    // At 192min: at_risk (exactly 80%)
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 192), createdAt, policy).status).toBe("at_risk");
    // At 239min: at_risk
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 239), createdAt, policy).status).toBe("at_risk");
    // At 240min: breached
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 240), createdAt, policy).status).toBe("breached");
    // At 300min: breached
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 300), createdAt, policy).status).toBe("breached");
  });

  it("low ticket: at-risk at 2304min, breached at 2880min", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const policy = makePolicy({ priority: "low", responseMinutes: 480, resolutionMinutes: 2880 });

    // 80% of 2880 = 2304
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 2303), createdAt, policy).status).toBe("within_sla");
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 2304), createdAt, policy).status).toBe("at_risk");
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 2879), createdAt, policy).status).toBe("at_risk");
    expect(evaluateSlaStatus(minutesFromNow(createdAt, 2880), createdAt, policy).status).toBe("breached");
  });
});
