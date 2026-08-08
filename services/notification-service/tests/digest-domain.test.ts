/**
 * Notification Digest — Domain Tests
 *
 * Module: services/notification-service/src/modules/digest
 * Pack: Notification_Module_Test_Pack/10_Digest_Test_Prompt.md
 *
 * Tests:
 *   1. shouldAccumulate: rule exists + non-critical → digest; critical → immediate
 *   2. isWindowExpired: time window computation
 *   3. shouldFlushBySize: batch-size cap
 *   4. Edge cases: null rule, boundary timing, zero window
 */
import { describe, it, expect } from "vitest";
import { shouldAccumulate, isWindowExpired, shouldFlushBySize, type DigestRule } from "../src/modules/digest/domain.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RULE: DigestRule = {
  eventType: "leave.approved",
  channel: "email",
  accumulationWindowMinutes: 30,
  maxBatchSize: 10,
  digestTemplateId: "tmpl-001",
  enabled: true,
};

// ─── 1. shouldAccumulate ─────────────────────────────────────────────────────

describe("shouldAccumulate — digest accumulation decision", () => {
  it("rule exists + normal priority → accumulate (true)", () => {
    expect(shouldAccumulate(RULE, "normal")).toBe(true);
  });

  it("rule exists + low priority → accumulate", () => {
    expect(shouldAccumulate(RULE, "low")).toBe(true);
  });

  it("rule exists + high priority → accumulate", () => {
    expect(shouldAccumulate(RULE, "high")).toBe(true);
  });

  it("rule exists + CRITICAL priority → NEVER accumulate (immediate delivery)", () => {
    expect(shouldAccumulate(RULE, "critical")).toBe(false);
  });

  it("null rule → no accumulation (no digest configured)", () => {
    expect(shouldAccumulate(null, "normal")).toBe(false);
  });

  it("null rule + critical → no accumulation", () => {
    expect(shouldAccumulate(null, "critical")).toBe(false);
  });
});

// ─── 2. isWindowExpired ──────────────────────────────────────────────────────

describe("isWindowExpired — accumulation window timing", () => {
  it("within window → NOT expired", () => {
    const opened = new Date("2026-07-15T10:00:00Z");
    const now = new Date("2026-07-15T10:20:00Z"); // 20 min < 30 min window
    expect(isWindowExpired(opened, 30, now)).toBe(false);
  });

  it("at window boundary → expired (>= semantics)", () => {
    const opened = new Date("2026-07-15T10:00:00Z");
    const now = new Date("2026-07-15T10:30:00Z"); // exactly 30 min
    expect(isWindowExpired(opened, 30, now)).toBe(true);
  });

  it("past window → expired", () => {
    const opened = new Date("2026-07-15T10:00:00Z");
    const now = new Date("2026-07-15T11:00:00Z"); // 60 min > 30 min
    expect(isWindowExpired(opened, 30, now)).toBe(true);
  });

  it("accepts string date (ISO)", () => {
    expect(isWindowExpired("2026-07-15T10:00:00Z", 30, new Date("2026-07-15T10:31:00Z"))).toBe(true);
  });

  it("zero-minute window → immediately expired", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    expect(isWindowExpired(now, 0, now)).toBe(true);
  });

  it("very long window (1440 min / 24h) stays open", () => {
    const opened = new Date("2026-07-15T00:00:00Z");
    const now = new Date("2026-07-15T23:00:00Z"); // 23h < 24h
    expect(isWindowExpired(opened, 1440, now)).toBe(false);
  });
});

// ─── 3. shouldFlushBySize ────────────────────────────────────────────────────

describe("shouldFlushBySize — batch size cap", () => {
  it("below max → no flush", () => {
    expect(shouldFlushBySize(5, 10)).toBe(false);
  });

  it("at max → flush", () => {
    expect(shouldFlushBySize(10, 10)).toBe(true);
  });

  it("above max → flush", () => {
    expect(shouldFlushBySize(15, 10)).toBe(true);
  });

  it("single item with max=1 → flush immediately", () => {
    expect(shouldFlushBySize(1, 1)).toBe(true);
  });

  it("zero items → no flush", () => {
    expect(shouldFlushBySize(0, 10)).toBe(false);
  });
});
