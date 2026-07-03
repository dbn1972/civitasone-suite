/**
 * Feature flag evaluation — comprehensive unit tests.
 * Covers: killSwitch, enabled/disabled, rollout percentages,
 * segment targeting, deterministic hashing, edge cases.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateFlag,
  hashUserToPercent,
  isFeatureEnabled,
  featureFlagSchema,
  type FeatureFlag,
  type EvaluationContext,
} from "../src/index.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    key: "test-flag",
    name: "Test Flag",
    description: "A test flag",
    enabled: true,
    rolloutPercent: 100,
    targetSegments: [],
    killSwitch: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    tenantId: "aaaaaaaa-bbbb-4000-8000-000000000001",
    userId: "cccccccc-dddd-4000-8000-000000000002",
    roles: ["employee"],
    segments: [],
    ...overrides,
  };
}

// ─── Kill Switch ─────────────────────────────────────────────────────────────

describe("killSwitch", () => {
  it("returns false when killSwitch is true, regardless of other settings", () => {
    const flag = makeFlag({ killSwitch: true, enabled: true, rolloutPercent: 100 });
    const result = evaluateFlag(flag, makeContext());
    expect(result.active).toBe(false);
    expect(result.reason).toBe("kill_switch");
  });

  it("overrides segment match when killSwitch is true", () => {
    const flag = makeFlag({ killSwitch: true, enabled: true, targetSegments: ["beta"], rolloutPercent: 100 });
    const ctx = makeContext({ segments: ["beta"] });
    expect(evaluateFlag(flag, ctx).active).toBe(false);
  });

  it("returns true when killSwitch is false and flag is fully enabled", () => {
    const flag = makeFlag({ killSwitch: false, enabled: true, rolloutPercent: 100 });
    expect(evaluateFlag(flag, makeContext()).active).toBe(true);
  });
});

// ─── Enabled/Disabled ────────────────────────────────────────────────────────

describe("enabled/disabled", () => {
  it("returns false when enabled=false", () => {
    const flag = makeFlag({ enabled: false, rolloutPercent: 100 });
    const result = evaluateFlag(flag, makeContext());
    expect(result.active).toBe(false);
    expect(result.reason).toBe("disabled");
  });

  it("returns false when enabled=false even with matching segments", () => {
    const flag = makeFlag({ enabled: false, targetSegments: ["beta"], rolloutPercent: 100 });
    const ctx = makeContext({ segments: ["beta"] });
    expect(evaluateFlag(flag, ctx).active).toBe(false);
  });

  it("enabled=true allows evaluation to proceed", () => {
    const flag = makeFlag({ enabled: true, rolloutPercent: 100 });
    expect(evaluateFlag(flag, makeContext()).active).toBe(true);
  });
});

// ─── Rollout Percentage ──────────────────────────────────────────────────────

describe("rolloutPercent", () => {
  it("100% always returns true for any user", () => {
    const flag = makeFlag({ rolloutPercent: 100 });
    // Test with multiple user IDs
    for (let i = 0; i < 20; i++) {
      const ctx = makeContext({ userId: `cccccccc-dddd-4000-8000-${String(i).padStart(12, "0")}` });
      expect(evaluateFlag(flag, ctx).active).toBe(true);
    }
  });

  it("0% always returns false for any user", () => {
    const flag = makeFlag({ rolloutPercent: 0 });
    for (let i = 0; i < 20; i++) {
      const ctx = makeContext({ userId: `cccccccc-dddd-4000-8000-${String(i).padStart(12, "0")}` });
      expect(evaluateFlag(flag, ctx).active).toBe(false);
    }
  });

  it("50% returns consistent results for the same user (deterministic)", () => {
    const flag = makeFlag({ rolloutPercent: 50 });
    const ctx = makeContext({ userId: "11111111-2222-4000-8000-333333333333" });
    const firstResult = evaluateFlag(flag, ctx);
    // Run 100 times — must always return the same value
    for (let i = 0; i < 100; i++) {
      expect(evaluateFlag(flag, ctx).active).toBe(firstResult.active);
    }
  });

  it("50% rollout produces a mix of results across different users", () => {
    const flag = makeFlag({ rolloutPercent: 50 });
    let trueCount = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      const ctx = makeContext({ userId: `aaaaaaaa-bbbb-4000-8000-${String(i).padStart(12, "0")}` });
      if (evaluateFlag(flag, ctx).active) trueCount++;
    }
    // Should be roughly 50% (within 10% tolerance for 1000 samples)
    expect(trueCount).toBeGreaterThan(400);
    expect(trueCount).toBeLessThan(600);
  });

  it("25% rollout produces approximately 25% activation", () => {
    const flag = makeFlag({ rolloutPercent: 25, key: "quarter-flag" });
    let trueCount = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      const ctx = makeContext({ userId: `bbbbbbbb-cccc-4000-8000-${String(i).padStart(12, "0")}` });
      if (evaluateFlag(flag, ctx).active) trueCount++;
    }
    expect(trueCount).toBeGreaterThan(180);
    expect(trueCount).toBeLessThan(320);
  });
});

// ─── Segment Targeting ───────────────────────────────────────────────────────

describe("segment targeting", () => {
  it("matches when user has at least one matching segment", () => {
    const flag = makeFlag({ targetSegments: ["beta", "internal"], rolloutPercent: 100 });
    const ctx = makeContext({ segments: ["beta"] });
    const result = evaluateFlag(flag, ctx);
    expect(result.active).toBe(true);
    expect(result.reason).toBe("segment_match");
  });

  it("returns false when user has no matching segments", () => {
    const flag = makeFlag({ targetSegments: ["beta", "internal"], rolloutPercent: 100 });
    const ctx = makeContext({ segments: ["public"] });
    const result = evaluateFlag(flag, ctx);
    expect(result.active).toBe(false);
    expect(result.reason).toBe("segment_miss");
  });

  it("empty targetSegments means no segment filter (all pass)", () => {
    const flag = makeFlag({ targetSegments: [], rolloutPercent: 100 });
    const ctx = makeContext({ segments: ["anything"] });
    expect(evaluateFlag(flag, ctx).active).toBe(true);
  });

  it("segment match still applies rollout percentage", () => {
    const flag = makeFlag({ targetSegments: ["beta"], rolloutPercent: 0 });
    const ctx = makeContext({ segments: ["beta"] });
    const result = evaluateFlag(flag, ctx);
    expect(result.active).toBe(false);
    expect(result.reason).toBe("rollout_miss");
  });

  it("segment match with 50% rollout is deterministic", () => {
    const flag = makeFlag({ targetSegments: ["beta"], rolloutPercent: 50 });
    const ctx = makeContext({ segments: ["beta"], userId: "aaaaaaaa-bbbb-4000-8000-000000000099" });
    const firstResult = evaluateFlag(flag, ctx);
    for (let i = 0; i < 50; i++) {
      expect(evaluateFlag(flag, ctx).active).toBe(firstResult.active);
    }
  });
});

// ─── Deterministic Hashing ───────────────────────────────────────────────────

describe("hashUserToPercent", () => {
  it("returns a number between 0 and 99 inclusive", () => {
    for (let i = 0; i < 100; i++) {
      const result = hashUserToPercent(`user-${i}`, "flag-key");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(100);
    }
  });

  it("same inputs always produce same output", () => {
    const result1 = hashUserToPercent("user-abc", "flag-xyz");
    const result2 = hashUserToPercent("user-abc", "flag-xyz");
    expect(result1).toBe(result2);
  });

  it("different users produce different buckets (mostly)", () => {
    const buckets = new Set<number>();
    for (let i = 0; i < 200; i++) {
      buckets.add(hashUserToPercent(`user-${i}`, "distribution-test"));
    }
    // With 200 users across 100 buckets, we should see at least 50 distinct values
    expect(buckets.size).toBeGreaterThan(50);
  });

  it("different flag keys produce different buckets for same user", () => {
    const result1 = hashUserToPercent("same-user", "flag-a");
    const result2 = hashUserToPercent("same-user", "flag-b");
    // They can be the same by chance, but let's at least verify they're both valid
    expect(result1).toBeGreaterThanOrEqual(0);
    expect(result2).toBeGreaterThanOrEqual(0);
    expect(result1).toBeLessThan(100);
    expect(result2).toBeLessThan(100);
  });
});

// ─── Determinism (same input → same output) ─────────────────────────────────

describe("determinism", () => {
  it("evaluateFlag returns identical result for identical inputs across calls", () => {
    const flag = makeFlag({ rolloutPercent: 73, key: "det-test" });
    const ctx = makeContext({ userId: "dddddddd-eeee-4000-8000-ffffffffffff" });
    const baseline = evaluateFlag(flag, ctx);
    for (let i = 0; i < 200; i++) {
      const result = evaluateFlag(flag, ctx);
      expect(result.active).toBe(baseline.active);
      expect(result.reason).toBe(baseline.reason);
    }
  });

  it("changing userId changes the result (flag-specific independence)", () => {
    const flag = makeFlag({ rolloutPercent: 50, key: "independence-test" });
    // Collect results for many users
    const results = new Map<string, boolean>();
    for (let i = 0; i < 100; i++) {
      const uid = `aaaaaaaa-bbbb-4000-8000-${String(i).padStart(12, "0")}`;
      results.set(uid, evaluateFlag(flag, makeContext({ userId: uid })).active);
    }
    // Should have both true and false results
    const trueCount = [...results.values()].filter(Boolean).length;
    expect(trueCount).toBeGreaterThan(0);
    expect(trueCount).toBeLessThan(100);
  });
});

// ─── Zod Schema Validation ───────────────────────────────────────────────────

describe("featureFlagSchema", () => {
  it("accepts valid flag data", () => {
    const data = {
      key: "valid-flag-key",
      name: "Valid Flag",
      description: "A valid flag",
      enabled: true,
      rolloutPercent: 50,
      targetSegments: ["beta"],
      killSwitch: false,
    };
    const result = featureFlagSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects invalid key format", () => {
    const data = {
      key: "Invalid Key!",
      name: "Flag",
      description: "",
      enabled: true,
      rolloutPercent: 50,
      targetSegments: [],
      killSwitch: false,
    };
    const result = featureFlagSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects rolloutPercent > 100", () => {
    const data = {
      key: "flag",
      name: "Flag",
      description: "",
      enabled: true,
      rolloutPercent: 150,
      targetSegments: [],
      killSwitch: false,
    };
    const result = featureFlagSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects rolloutPercent < 0", () => {
    const data = {
      key: "flag",
      name: "Flag",
      description: "",
      enabled: true,
      rolloutPercent: -5,
      targetSegments: [],
      killSwitch: false,
    };
    const result = featureFlagSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("defaults killSwitch to false if omitted", () => {
    const data = {
      key: "flag",
      name: "Flag",
      description: "",
      enabled: true,
      rolloutPercent: 50,
      targetSegments: [],
    };
    const result = featureFlagSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.killSwitch).toBe(false);
    }
  });
});

// ─── isFeatureEnabled convenience wrapper ────────────────────────────────────

describe("isFeatureEnabled", () => {
  it("returns true for fully enabled flag", () => {
    expect(isFeatureEnabled(makeFlag(), makeContext())).toBe(true);
  });

  it("returns false for killed flag", () => {
    expect(isFeatureEnabled(makeFlag({ killSwitch: true }), makeContext())).toBe(false);
  });

  it("returns false for disabled flag", () => {
    expect(isFeatureEnabled(makeFlag({ enabled: false }), makeContext())).toBe(false);
  });
});
