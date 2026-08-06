/**
 * G3 — Stage SLA domain logic unit tests.
 * Covers: computeDeadline, isBreached, isWarning, elapsedPercent.
 * Pure logic — no DB or IO required.
 */
import { describe, it, expect } from "vitest";
import { computeDeadline, isBreached, isWarning, elapsedPercent } from "../src/modules/stage-sla/domain.js";

const HOUR_MS = 60 * 60 * 1000;

describe("computeDeadline", () => {
  it("adds slaHours to enteredAt", () => {
    const entered = new Date("2025-01-10T08:00:00Z");
    const deadline = computeDeadline(entered, 24);
    expect(deadline).toEqual(new Date("2025-01-11T08:00:00Z"));
  });

  it("handles fractional-hour boundaries correctly", () => {
    const entered = new Date("2025-06-01T00:00:00Z");
    const deadline = computeDeadline(entered, 1);
    expect(deadline).toEqual(new Date("2025-06-01T01:00:00Z"));
  });

  it("returns null for zero slaHours", () => {
    expect(computeDeadline(new Date(), 0)).toBeNull();
  });

  it("returns null for negative slaHours", () => {
    expect(computeDeadline(new Date(), -5)).toBeNull();
  });

  it("handles large slaHours (365 days)", () => {
    const entered = new Date("2025-01-01T00:00:00Z");
    const deadline = computeDeadline(entered, 8760); // 365 * 24
    expect(deadline).toEqual(new Date("2026-01-01T00:00:00Z"));
  });
});

describe("isBreached", () => {
  it("returns false when within SLA", () => {
    const entered = new Date("2025-01-10T08:00:00Z");
    const now = new Date("2025-01-10T20:00:00Z"); // 12h elapsed, 24h SLA
    expect(isBreached(entered, now, 24)).toBe(false);
  });

  it("returns true when exactly at deadline", () => {
    const entered = new Date("2025-01-10T08:00:00Z");
    const now = new Date("2025-01-11T08:00:00Z"); // exactly 24h
    expect(isBreached(entered, now, 24)).toBe(true);
  });

  it("returns true when past deadline", () => {
    const entered = new Date("2025-01-10T08:00:00Z");
    const now = new Date("2025-01-12T08:00:00Z"); // 48h > 24h
    expect(isBreached(entered, now, 24)).toBe(true);
  });

  it("returns false for slaHours <= 0", () => {
    expect(isBreached(new Date(), new Date(), 0)).toBe(false);
    expect(isBreached(new Date(), new Date(), -1)).toBe(false);
  });

  it("returns false when now is before enteredAt (negative elapsed)", () => {
    const entered = new Date("2025-01-10T12:00:00Z");
    const now = new Date("2025-01-10T08:00:00Z"); // before entry
    expect(isBreached(entered, now, 24)).toBe(false);
  });

  it("handles 1-hour SLA with 1ms over", () => {
    const entered = new Date("2025-01-10T10:00:00Z");
    const deadline = new Date(entered.getTime() + 1 * HOUR_MS);
    const justOver = new Date(deadline.getTime() + 1);
    expect(isBreached(entered, justOver, 1)).toBe(true);
  });
});

describe("isWarning", () => {
  const policy = { slaHours: 10, warnAtPercent: 80 };

  it("returns false when below warning threshold", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 7 * HOUR_MS); // 70% < 80%
    expect(isWarning(entered, now, policy)).toBe(false);
  });

  it("returns true when at warning threshold", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 8 * HOUR_MS); // exactly 80%
    expect(isWarning(entered, now, policy)).toBe(true);
  });

  it("returns true when between warning and breach", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 9 * HOUR_MS); // 90%
    expect(isWarning(entered, now, policy)).toBe(true);
  });

  it("returns false when breached (at deadline)", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 10 * HOUR_MS); // 100% = breached
    expect(isWarning(entered, now, policy)).toBe(false);
  });

  it("returns false when breached (past deadline)", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 12 * HOUR_MS); // 120%
    expect(isWarning(entered, now, policy)).toBe(false);
  });

  it("returns false for slaHours <= 0", () => {
    expect(isWarning(new Date(), new Date(), { slaHours: 0, warnAtPercent: 80 })).toBe(false);
  });

  it("returns false for warnAtPercent 0 or 100 (edge case)", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 5 * HOUR_MS);
    expect(isWarning(entered, now, { slaHours: 10, warnAtPercent: 0 })).toBe(false);
    expect(isWarning(entered, now, { slaHours: 10, warnAtPercent: 100 })).toBe(false);
  });

  it("handles warnAtPercent=50 correctly", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const at50 = new Date(entered.getTime() + 5 * HOUR_MS);
    const at49 = new Date(entered.getTime() + 4.9 * HOUR_MS);
    expect(isWarning(entered, at50, { slaHours: 10, warnAtPercent: 50 })).toBe(true);
    expect(isWarning(entered, at49, { slaHours: 10, warnAtPercent: 50 })).toBe(false);
  });
});

describe("elapsedPercent", () => {
  it("returns 0 when now equals enteredAt", () => {
    const t = new Date("2025-01-10T00:00:00Z");
    expect(elapsedPercent(t, t, 10)).toBe(0);
  });

  it("returns 50 at halfway point", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 5 * HOUR_MS);
    expect(elapsedPercent(entered, now, 10)).toBe(50);
  });

  it("returns 100 at exactly the deadline", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 10 * HOUR_MS);
    expect(elapsedPercent(entered, now, 10)).toBe(100);
  });

  it("returns > 100 when past deadline", () => {
    const entered = new Date("2025-01-10T00:00:00Z");
    const now = new Date(entered.getTime() + 15 * HOUR_MS);
    expect(elapsedPercent(entered, now, 10)).toBe(150);
  });

  it("returns 0 (clamped) when now is before enteredAt", () => {
    const entered = new Date("2025-01-10T12:00:00Z");
    const now = new Date("2025-01-10T08:00:00Z");
    expect(elapsedPercent(entered, now, 10)).toBe(0);
  });

  it("returns 0 for slaHours <= 0", () => {
    expect(elapsedPercent(new Date(), new Date(), 0)).toBe(0);
    expect(elapsedPercent(new Date(), new Date(), -1)).toBe(0);
  });
});
