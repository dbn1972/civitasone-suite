/**
 * CAP-094 — unit tests for the pure feature-flag evaluation domain:
 * kill switch, expiry, percentage bucketing, and segment targeting.
 */
import { describe, it, expect } from "vitest";
import { evaluateFlag, bucketOf, isExpired, type FlagState } from "../src/modules/feature-flags/domain.js";

const base: FlagState = {
  key: "new-checkout",
  enabled: true,
  rolloutPercent: 0,
  targetSegments: [],
  killSwitch: false,
  expiresAt: null,
};

describe("bucketOf", () => {
  it("is deterministic for the same inputs", () => {
    expect(bucketOf("k", "s1")).toBe(bucketOf("k", "s1"));
  });
  it("stays within [0,100)", () => {
    for (let i = 0; i < 200; i++) {
      const b = bucketOf("k", `subject-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
  it("differs across subjects (spreads the space)", () => {
    const buckets = new Set(Array.from({ length: 100 }, (_, i) => bucketOf("k", `s${i}`)));
    expect(buckets.size).toBeGreaterThan(50);
  });
});

describe("isExpired", () => {
  it("false for null/undefined", () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(undefined)).toBe(false);
  });
  it("true for a past date, false for a future date", () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
  it("false for an unparseable value (fail-open on garbage)", () => {
    expect(isExpired("not-a-date")).toBe(false);
  });
});

describe("evaluateFlag precedence", () => {
  it("kill switch forces OFF even when enabled + 100%", () => {
    const d = evaluateFlag({ ...base, enabled: true, rolloutPercent: 100, killSwitch: true }, { subjectId: "s" });
    expect(d.enabled).toBe(false);
    expect(d.reason).toBe("kill_switch");
  });
  it("expiry forces OFF even when enabled + 100%", () => {
    const d = evaluateFlag({ ...base, enabled: true, rolloutPercent: 100, expiresAt: new Date(Date.now() - 1) }, { subjectId: "s" });
    expect(d.enabled).toBe(false);
    expect(d.reason).toBe("expired");
  });
  it("disabled flag is OFF", () => {
    const d = evaluateFlag({ ...base, enabled: false, rolloutPercent: 100 }, { subjectId: "s" });
    expect(d.reason).toBe("disabled");
  });
  it("segment match bypasses the percentage", () => {
    const d = evaluateFlag({ ...base, rolloutPercent: 0, targetSegments: ["beta"] }, { subjectId: "s", segments: ["beta"] });
    expect(d.enabled).toBe(true);
    expect(d.reason).toBe("segment_match");
  });
  it("0% with no segment is OFF", () => {
    const d = evaluateFlag({ ...base, rolloutPercent: 0 }, { subjectId: "s" });
    expect(d.enabled).toBe(false);
    expect(d.reason).toBe("percentage_out");
  });
  it("100% is ON for everyone", () => {
    const d = evaluateFlag({ ...base, rolloutPercent: 100 }, { subjectId: "anyone" });
    expect(d.enabled).toBe(true);
    expect(d.reason).toBe("percentage_in");
  });
  it("percentage inclusion is monotonic and roughly proportional", () => {
    const N = 1000;
    let on = 0;
    for (let i = 0; i < N; i++) {
      if (evaluateFlag({ ...base, rolloutPercent: 30 }, { subjectId: `u${i}` }).enabled) on++;
    }
    // ~30% ± 5pp tolerance for the hash spread.
    expect(on / N).toBeGreaterThan(0.25);
    expect(on / N).toBeLessThan(0.35);
  });
  it("a subject enabled at X% stays enabled at X+ (monotonic rollout)", () => {
    const subject = { subjectId: "sticky-user" };
    const b = bucketOf(base.key, subject.subjectId);
    const atThreshold = evaluateFlag({ ...base, rolloutPercent: b + 1 }, subject);
    const higher = evaluateFlag({ ...base, rolloutPercent: 100 }, subject);
    expect(atThreshold.enabled).toBe(true);
    expect(higher.enabled).toBe(true);
  });
});
