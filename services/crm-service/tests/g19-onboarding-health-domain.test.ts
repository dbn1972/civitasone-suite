/**
 * Onboarding health metric framework (G19) — pure domain tests.
 *
 * These verify the properties an operator relies on when reading a health score:
 * - A score of 100 means all milestones hit on time
 * - A score of 0 means all active milestones overdue with none hit
 * - Inactive rules never affect the score
 * - The score is bounded [0, 100]
 * - "Hit" and "overdue" are mutually consistent: a milestone cannot be both
 *   hit (event arrived on time) and overdue (deadline passed with no event)
 */
import { describe, it, expect } from "vitest";
import {
  computeOnboardingHealth,
  isMilestoneHit,
  isMilestoneOverdue,
  type HealthRule,
  type MilestoneEvent,
} from "../src/modules/onboarding-health/domain.js";

const DAY = 86_400_000;

function makeRule(overrides: Partial<HealthRule> = {}): HealthRule {
  return {
    ruleKey: "first_shipment",
    milestoneEvent: "first_shipment",
    expectedWithinDays: 7,
    weight: 50,
    active: true,
    ...overrides,
  };
}

function makeEvent(eventType: string, daysAfterCreation: number, caseCreatedAt: Date): MilestoneEvent {
  return {
    eventType,
    occurredAt: new Date(caseCreatedAt.getTime() + daysAfterCreation * DAY),
  };
}

describe("isMilestoneHit", () => {
  const caseCreatedAt = new Date("2025-01-01T00:00:00Z");

  it("returns true when the event arrived before the deadline", () => {
    const rule = makeRule({ expectedWithinDays: 7 });
    const events = [makeEvent("first_shipment", 5, caseCreatedAt)];
    expect(isMilestoneHit(rule, events, caseCreatedAt)).toBe(true);
  });

  it("returns true when the event arrived exactly on the deadline", () => {
    const rule = makeRule({ expectedWithinDays: 7 });
    const events = [makeEvent("first_shipment", 7, caseCreatedAt)];
    expect(isMilestoneHit(rule, events, caseCreatedAt)).toBe(true);
  });

  it("returns false when the event arrived after the deadline", () => {
    const rule = makeRule({ expectedWithinDays: 7 });
    const events = [makeEvent("first_shipment", 8, caseCreatedAt)];
    expect(isMilestoneHit(rule, events, caseCreatedAt)).toBe(false);
  });

  it("returns false when no matching event exists", () => {
    const rule = makeRule({ milestoneEvent: "first_shipment" });
    const events = [makeEvent("kyc_verified", 3, caseCreatedAt)];
    expect(isMilestoneHit(rule, events, caseCreatedAt)).toBe(false);
  });

  it("returns false when there are no events at all", () => {
    const rule = makeRule();
    expect(isMilestoneHit(rule, [], caseCreatedAt)).toBe(false);
  });

  it("returns true if any matching event is within the window even if later ones are not", () => {
    const rule = makeRule({ expectedWithinDays: 7 });
    const events = [
      makeEvent("first_shipment", 5, caseCreatedAt),
      makeEvent("first_shipment", 10, caseCreatedAt),
    ];
    expect(isMilestoneHit(rule, events, caseCreatedAt)).toBe(true);
  });
});

describe("isMilestoneOverdue", () => {
  const caseCreatedAt = new Date("2025-01-01T00:00:00Z");

  it("returns true when deadline passed and no event exists", () => {
    const rule = makeRule({ expectedWithinDays: 7 });
    const now = new Date(caseCreatedAt.getTime() + 8 * DAY);
    expect(isMilestoneOverdue(rule, [], caseCreatedAt, now)).toBe(true);
  });

  it("returns false when deadline has not yet passed", () => {
    const rule = makeRule({ expectedWithinDays: 7 });
    const now = new Date(caseCreatedAt.getTime() + 5 * DAY);
    expect(isMilestoneOverdue(rule, [], caseCreatedAt, now)).toBe(false);
  });

  it("returns false when now is exactly the deadline", () => {
    const rule = makeRule({ expectedWithinDays: 7 });
    const now = new Date(caseCreatedAt.getTime() + 7 * DAY);
    expect(isMilestoneOverdue(rule, [], caseCreatedAt, now)).toBe(false);
  });

  it("returns false when deadline passed but event exists (even late)", () => {
    const rule = makeRule({ expectedWithinDays: 7, milestoneEvent: "first_shipment" });
    const now = new Date(caseCreatedAt.getTime() + 10 * DAY);
    const events = [makeEvent("first_shipment", 9, caseCreatedAt)];
    expect(isMilestoneOverdue(rule, events, caseCreatedAt, now)).toBe(false);
  });

  it("returns true when deadline passed and only unrelated events exist", () => {
    const rule = makeRule({ expectedWithinDays: 7, milestoneEvent: "first_shipment" });
    const now = new Date(caseCreatedAt.getTime() + 10 * DAY);
    const events = [makeEvent("kyc_verified", 3, caseCreatedAt)];
    expect(isMilestoneOverdue(rule, events, caseCreatedAt, now)).toBe(true);
  });
});

describe("computeOnboardingHealth", () => {
  const caseCreatedAt = new Date("2025-01-01T00:00:00Z");

  it("returns 100 with empty milestones when there are no active rules", () => {
    const rules = [makeRule({ active: false })];
    const result = computeOnboardingHealth(rules, [], caseCreatedAt, new Date());
    expect(result.score).toBe(100);
    expect(result.milestones).toEqual([]);
  });

  it("returns 100 when all milestones are hit on time", () => {
    const rules = [
      makeRule({ ruleKey: "first_shipment", milestoneEvent: "first_shipment", expectedWithinDays: 7, weight: 50 }),
      makeRule({ ruleKey: "kyc_verified", milestoneEvent: "kyc_verified", expectedWithinDays: 14, weight: 50 }),
    ];
    const events = [
      makeEvent("first_shipment", 3, caseCreatedAt),
      makeEvent("kyc_verified", 10, caseCreatedAt),
    ];
    const now = new Date(caseCreatedAt.getTime() + 20 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    expect(result.score).toBe(100);
    expect(result.milestones).toHaveLength(2);
    expect(result.milestones.every((m) => m.hit)).toBe(true);
  });

  it("returns 0 when all milestones are overdue and none hit", () => {
    const rules = [
      makeRule({ ruleKey: "first_shipment", milestoneEvent: "first_shipment", expectedWithinDays: 7, weight: 50 }),
      makeRule({ ruleKey: "kyc_verified", milestoneEvent: "kyc_verified", expectedWithinDays: 14, weight: 50 }),
    ];
    const now = new Date(caseCreatedAt.getTime() + 30 * DAY);
    const result = computeOnboardingHealth(rules, [], caseCreatedAt, now);
    expect(result.score).toBe(0);
    expect(result.milestones.every((m) => m.overdue && !m.hit)).toBe(true);
  });

  it("computes a weighted partial score when some milestones hit", () => {
    const rules = [
      makeRule({ ruleKey: "first_shipment", milestoneEvent: "first_shipment", expectedWithinDays: 7, weight: 60 }),
      makeRule({ ruleKey: "first_payment", milestoneEvent: "first_payment", expectedWithinDays: 30, weight: 40 }),
    ];
    const events = [makeEvent("first_shipment", 5, caseCreatedAt)];
    const now = new Date(caseCreatedAt.getTime() + 40 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    // 60 / (60+40) * 100 = 60
    expect(result.score).toBe(60);
    expect(result.milestones[0]!.hit).toBe(true);
    expect(result.milestones[1]!.hit).toBe(false);
    expect(result.milestones[1]!.overdue).toBe(true);
  });

  it("ignores inactive rules entirely", () => {
    const rules = [
      makeRule({ ruleKey: "active_one", milestoneEvent: "first_shipment", expectedWithinDays: 7, weight: 50, active: true }),
      makeRule({ ruleKey: "inactive_one", milestoneEvent: "first_payment", expectedWithinDays: 30, weight: 50, active: false }),
    ];
    const events = [makeEvent("first_shipment", 5, caseCreatedAt)];
    const now = new Date(caseCreatedAt.getTime() + 40 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    expect(result.score).toBe(100);
    expect(result.milestones).toHaveLength(1);
  });

  it("treats pending milestones (within window, not yet hit) as not contributing", () => {
    const rules = [
      makeRule({ ruleKey: "first_shipment", milestoneEvent: "first_shipment", expectedWithinDays: 30, weight: 50 }),
      makeRule({ ruleKey: "kyc_verified", milestoneEvent: "kyc_verified", expectedWithinDays: 14, weight: 50 }),
    ];
    const events = [makeEvent("kyc_verified", 5, caseCreatedAt)];
    // Now is day 10 — first_shipment's window (30 days) hasn't passed
    const now = new Date(caseCreatedAt.getTime() + 10 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    // kyc_verified hit (50), first_shipment pending (0). 50/100 = 50%
    expect(result.score).toBe(50);
    expect(result.milestones.find((m) => m.ruleKey === "first_shipment")!.hit).toBe(false);
    expect(result.milestones.find((m) => m.ruleKey === "first_shipment")!.overdue).toBe(false);
  });

  it("score is always bounded between 0 and 100", () => {
    for (let weight = 0; weight <= 100; weight += 10) {
      const rules = [makeRule({ weight })];
      const now = new Date(caseCreatedAt.getTime() + 100 * DAY);
      const result = computeOnboardingHealth(rules, [], caseCreatedAt, now);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it("handles all rules having zero weight gracefully (score 100)", () => {
    const rules = [
      makeRule({ ruleKey: "a", milestoneEvent: "a", weight: 0 }),
      makeRule({ ruleKey: "b", milestoneEvent: "b", weight: 0 }),
    ];
    const now = new Date(caseCreatedAt.getTime() + 100 * DAY);
    const result = computeOnboardingHealth(rules, [], caseCreatedAt, now);
    expect(result.score).toBe(100);
  });

  it("score rounds to the nearest integer", () => {
    const rules = [
      makeRule({ ruleKey: "a", milestoneEvent: "a", expectedWithinDays: 7, weight: 33 }),
      makeRule({ ruleKey: "b", milestoneEvent: "b", expectedWithinDays: 7, weight: 33 }),
      makeRule({ ruleKey: "c", milestoneEvent: "c", expectedWithinDays: 7, weight: 34 }),
    ];
    const events = [makeEvent("a", 3, caseCreatedAt)];
    const now = new Date(caseCreatedAt.getTime() + 10 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    // 33/100 * 100 = 33
    expect(result.score).toBe(33);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("milestones array reports correct hit/overdue for each rule", () => {
    const rules = [
      makeRule({ ruleKey: "shipment", milestoneEvent: "first_shipment", expectedWithinDays: 7, weight: 50 }),
      makeRule({ ruleKey: "payment", milestoneEvent: "first_payment", expectedWithinDays: 14, weight: 50 }),
    ];
    const events = [makeEvent("first_shipment", 5, caseCreatedAt)];
    const now = new Date(caseCreatedAt.getTime() + 20 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);

    const shipment = result.milestones.find((m) => m.ruleKey === "shipment")!;
    const payment = result.milestones.find((m) => m.ruleKey === "payment")!;

    expect(shipment.hit).toBe(true);
    expect(shipment.overdue).toBe(false);
    expect(payment.hit).toBe(false);
    expect(payment.overdue).toBe(true);
  });

  it("a milestone cannot be both hit and overdue", () => {
    // Hit means event arrived within window — by definition the deadline passed,
    // but overdue checks "no event at all" so they are mutually exclusive.
    const rules = [
      makeRule({ ruleKey: "x", milestoneEvent: "x", expectedWithinDays: 7, weight: 100 }),
    ];
    const events = [makeEvent("x", 5, caseCreatedAt)];
    const now = new Date(caseCreatedAt.getTime() + 20 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    const m = result.milestones[0]!;
    // Cannot be both true simultaneously
    expect(m.hit && m.overdue).toBe(false);
  });

  it("is deterministic — same inputs always produce the same score", () => {
    const rules = [
      makeRule({ ruleKey: "a", milestoneEvent: "a", expectedWithinDays: 7, weight: 40 }),
      makeRule({ ruleKey: "b", milestoneEvent: "b", expectedWithinDays: 14, weight: 60 }),
    ];
    const events = [makeEvent("a", 3, caseCreatedAt)];
    const now = new Date(caseCreatedAt.getTime() + 20 * DAY);

    const r1 = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    const r2 = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    expect(r1).toEqual(r2);
  });

  it("handles an empty rules array as a healthy state", () => {
    const result = computeOnboardingHealth([], [], caseCreatedAt, new Date());
    expect(result.score).toBe(100);
    expect(result.milestones).toEqual([]);
  });

  it("multiple events for the same milestone — uses the earliest qualifying one", () => {
    const rules = [
      makeRule({ ruleKey: "ship", milestoneEvent: "first_shipment", expectedWithinDays: 7, weight: 100 }),
    ];
    // First event on day 6 (within window), second on day 10 (outside).
    // The milestone is hit because at least one was within the window.
    const events = [
      makeEvent("first_shipment", 6, caseCreatedAt),
      makeEvent("first_shipment", 10, caseCreatedAt),
    ];
    const now = new Date(caseCreatedAt.getTime() + 15 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    expect(result.score).toBe(100);
    expect(result.milestones[0]!.hit).toBe(true);
  });

  it("unequal weights produce the correct proportional score", () => {
    const rules = [
      makeRule({ ruleKey: "heavy", milestoneEvent: "heavy", expectedWithinDays: 7, weight: 80 }),
      makeRule({ ruleKey: "light", milestoneEvent: "light", expectedWithinDays: 7, weight: 20 }),
    ];
    // Only the light one is hit
    const events = [makeEvent("light", 3, caseCreatedAt)];
    const now = new Date(caseCreatedAt.getTime() + 10 * DAY);
    const result = computeOnboardingHealth(rules, events, caseCreatedAt, now);
    // 20/100 * 100 = 20
    expect(result.score).toBe(20);
  });
});
