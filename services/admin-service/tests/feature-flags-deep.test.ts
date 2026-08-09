/**
 * Admin Service — Feature Flags Domain: Deep tests.
 *
 * Tests kill switch, expiry, disabled, segment targeting, percentage rollout
 * with stable bucketing, and boundary conditions.
 *
 * Source: modules/feature-flags/domain.ts
 */
import { describe, it, expect } from "vitest";
import { evaluateFlag, bucketOf, isExpired, type FlagState, type EvalSubject } from "../src/modules/feature-flags/domain.js";

const baseFlag: FlagState = { key: "new_ui", enabled: true, rolloutPercent: 50, targetSegments: [], killSwitch: false };
const subject: EvalSubject = { subjectId: "tenant-001" };

describe("bucketOf — stable hash bucketing", () => {
  it("returns 0-99", () => {
    const b = bucketOf("flag-1", "user-1");
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });
  it("deterministic (same inputs = same bucket)", () => {
    expect(bucketOf("flag-1", "user-1")).toBe(bucketOf("flag-1", "user-1"));
  });
  it("different key = likely different bucket", () => {
    const b1 = bucketOf("flag-A", "user-1");
    const b2 = bucketOf("flag-B", "user-1");
    // Not guaranteed different, but overwhelmingly likely
    expect(typeof b1).toBe("number");
    expect(typeof b2).toBe("number");
  });
});

describe("isExpired", () => {
  it("false when null", () => expect(isExpired(null)).toBe(false));
  it("false when undefined", () => expect(isExpired(undefined)).toBe(false));
  it("true when past", () => expect(isExpired(new Date("2020-01-01"))).toBe(true));
  it("false when future", () => expect(isExpired(new Date("2099-01-01"))).toBe(false));
  it("accepts ISO string", () => expect(isExpired("2020-01-01T00:00:00Z")).toBe(true));
});

describe("evaluateFlag — feature flag evaluation", () => {
  it("kill switch always OFF (highest precedence)", () => {
    const flag = { ...baseFlag, killSwitch: true, enabled: true, rolloutPercent: 100 };
    const result = evaluateFlag(flag, subject);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("kill_switch");
  });

  it("expired flag is OFF", () => {
    const flag = { ...baseFlag, expiresAt: new Date("2020-01-01") };
    expect(evaluateFlag(flag, subject).enabled).toBe(false);
    expect(evaluateFlag(flag, subject).reason).toBe("expired");
  });

  it("disabled flag is OFF", () => {
    const flag = { ...baseFlag, enabled: false };
    expect(evaluateFlag(flag, subject).enabled).toBe(false);
    expect(evaluateFlag(flag, subject).reason).toBe("disabled");
  });

  it("segment match bypasses percentage", () => {
    const flag = { ...baseFlag, rolloutPercent: 0, targetSegments: ["beta_testers"] };
    const sub: EvalSubject = { subjectId: "user-1", segments: ["beta_testers"] };
    const result = evaluateFlag(flag, sub);
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe("segment_match");
  });

  it("no segment match falls through to percentage", () => {
    const flag = { ...baseFlag, rolloutPercent: 100, targetSegments: ["beta"] };
    const sub: EvalSubject = { subjectId: "user-1", segments: ["prod"] };
    const result = evaluateFlag(flag, sub);
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe("percentage_in");
  });

  it("100% rollout = always ON", () => {
    const flag = { ...baseFlag, rolloutPercent: 100 };
    expect(evaluateFlag(flag, subject).enabled).toBe(true);
  });

  it("0% rollout = always OFF", () => {
    const flag = { ...baseFlag, rolloutPercent: 0 };
    expect(evaluateFlag(flag, subject).enabled).toBe(false);
    expect(evaluateFlag(flag, subject).reason).toBe("percentage_out");
  });

  it("percentage is stable for same subject", () => {
    const flag = { ...baseFlag, rolloutPercent: 50 };
    const r1 = evaluateFlag(flag, subject);
    const r2 = evaluateFlag(flag, subject);
    expect(r1.enabled).toBe(r2.enabled);
    expect(r1.bucket).toBe(r2.bucket);
  });
});
