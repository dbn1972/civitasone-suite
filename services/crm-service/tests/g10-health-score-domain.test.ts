/**
 * G10 — Account Health Score domain logic tests.
 *
 * Covers: computeHealthScore, decaySignal, edge cases.
 */
import { describe, it, expect } from "vitest";
import { computeHealthScore, decaySignal } from "../src/modules/health-score/domain.js";
import type { SignalInput, SignalConfig } from "../src/modules/health-score/domain.js";

const NOW = new Date("2025-07-15T00:00:00Z");

function makeConfig(overrides: Partial<SignalConfig> & Pick<SignalConfig, "signalName">): SignalConfig {
  return {
    weight: 50,
    decayDays: 90,
    enabled: true,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<SignalInput> & Pick<SignalInput, "name">): SignalInput {
  return {
    value: 100,
    recordedAt: NOW, // no decay
    ...overrides,
  };
}

describe("decaySignal", () => {
  it("returns full value when age is 0", () => {
    expect(decaySignal(100, 0, 90)).toBe(100);
  });

  it("returns half value at exactly one half-life", () => {
    const result = decaySignal(100, 90, 90);
    expect(result).toBeCloseTo(50, 5);
  });

  it("returns quarter value at two half-lives", () => {
    const result = decaySignal(100, 180, 90);
    expect(result).toBeCloseTo(25, 5);
  });

  it("returns 0 when value is 0", () => {
    expect(decaySignal(0, 30, 90)).toBe(0);
  });

  it("returns 0 when value is negative", () => {
    expect(decaySignal(-10, 30, 90)).toBe(0);
  });

  it("returns full value when age is negative", () => {
    expect(decaySignal(80, -5, 90)).toBe(80);
  });

  it("returns 0 when decayDays is 0", () => {
    expect(decaySignal(100, 10, 0)).toBe(0);
  });

  it("returns 0 when decayDays is negative", () => {
    expect(decaySignal(100, 10, -5)).toBe(0);
  });

  it("applies correct decay for fractional periods", () => {
    // At 45 days (half of 90-day half-life), decay factor = 0.5^(45/90) = 0.5^0.5 ≈ 0.707
    const result = decaySignal(100, 45, 90);
    expect(result).toBeCloseTo(70.71, 1);
  });

  it("approaches zero for very old signals", () => {
    const result = decaySignal(100, 900, 90); // 10 half-lives
    expect(result).toBeLessThan(0.1);
  });
});

describe("computeHealthScore — all-green signals", () => {
  it("returns 100 when all signals are 100 with no decay", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 30 }),
      makeConfig({ signalName: "deal_velocity", weight: 40 }),
      makeConfig({ signalName: "payment_health", weight: 30 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 100 }),
      makeSignal({ name: "deal_velocity", value: 100 }),
      makeSignal({ name: "payment_health", value: 100 }),
    ];

    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(100);
  });

  it("returns correct weighted average", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 60 }),
      makeConfig({ signalName: "deal_velocity", weight: 40 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 80 }),
      makeSignal({ name: "deal_velocity", value: 60 }),
    ];

    // Weighted avg = (80*60 + 60*40) / (60+40) = (4800+2400)/100 = 72
    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(72);
  });
});

describe("computeHealthScore — mixed signals", () => {
  it("handles mix of strong and weak signals", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 50, decayDays: 30 }),
      makeConfig({ signalName: "ticket_frequency", weight: 25, decayDays: 60 }),
      makeConfig({ signalName: "payment_health", weight: 25, decayDays: 90 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 100 }), // fresh
      makeSignal({ name: "ticket_frequency", value: 40 }),   // low
      makeSignal({ name: "payment_health", value: 90 }),     // good
    ];

    // No decay (all recorded at NOW):
    // (100*50 + 40*25 + 90*25) / (50+25+25) = (5000+1000+2250)/100 = 82.5 → 83
    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(83);
  });

  it("applies decay to stale signals", () => {
    const thirtyDaysAgo = new Date("2025-06-15T00:00:00Z"); // 30 days before NOW
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 50, decayDays: 30 }),
      makeConfig({ signalName: "deal_velocity", weight: 50, decayDays: 30 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 100, recordedAt: thirtyDaysAgo }), // 1 half-life → 50
      makeSignal({ name: "deal_velocity", value: 100 }), // fresh → 100
    ];

    // decayed activity = 50, fresh deal = 100
    // weighted avg = (50*50 + 100*50) / 100 = 75
    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(75);
  });
});

describe("computeHealthScore — missing signals", () => {
  it("gracefully handles missing signals (excludes from average)", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 50 }),
      makeConfig({ signalName: "deal_velocity", weight: 30 }),
      makeConfig({ signalName: "ticket_frequency", weight: 20 }),
    ];
    // Only provide one signal — the others are missing
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 80 }),
    ];

    // Only activity_recency contributes: 80*50 / 50 = 80
    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(80);
  });

  it("returns 0 when all signals are missing", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 50 }),
      makeConfig({ signalName: "deal_velocity", weight: 50 }),
    ];
    const signals: SignalInput[] = [];

    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(0);
  });

  it("ignores extra signals not in config", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 100 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 70 }),
      makeSignal({ name: "unknown_signal", value: 100 }),
    ];

    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(70);
  });
});

describe("computeHealthScore — decay over time", () => {
  it("score decreases as signals age", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 100, decayDays: 30 }),
    ];

    // Fresh
    const fresh = computeHealthScore(
      [makeSignal({ name: "activity_recency", value: 100 })],
      configs,
      NOW,
    );

    // 15 days old (half a half-life → ~70.7%)
    const halfLife = computeHealthScore(
      [makeSignal({ name: "activity_recency", value: 100, recordedAt: new Date("2025-06-30T00:00:00Z") })],
      configs,
      NOW,
    );

    // 30 days old (one half-life → 50%)
    const oneHalfLife = computeHealthScore(
      [makeSignal({ name: "activity_recency", value: 100, recordedAt: new Date("2025-06-15T00:00:00Z") })],
      configs,
      NOW,
    );

    // 60 days old (two half-lives → 25%)
    const twoHalfLives = computeHealthScore(
      [makeSignal({ name: "activity_recency", value: 100, recordedAt: new Date("2025-05-16T00:00:00Z") })],
      configs,
      NOW,
    );

    expect(fresh).toBe(100);
    expect(halfLife).toBe(71); // ~70.7 rounds to 71
    expect(oneHalfLife).toBe(50);
    expect(twoHalfLives).toBe(25);

    // Monotonically decreasing
    expect(fresh).toBeGreaterThan(halfLife);
    expect(halfLife).toBeGreaterThan(oneHalfLife);
    expect(oneHalfLife).toBeGreaterThan(twoHalfLives);
  });
});

describe("computeHealthScore — edge cases", () => {
  it("returns 0 when all weights are zero", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 0 }),
      makeConfig({ signalName: "deal_velocity", weight: 0 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 100 }),
      makeSignal({ name: "deal_velocity", value: 100 }),
    ];

    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(0);
  });

  it("returns 0 when configs array is empty", () => {
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 100 }),
    ];
    const result = computeHealthScore(signals, [], NOW);
    expect(result).toBe(0);
  });

  it("returns 0 when signals array is empty and configs exist", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 50 }),
    ];
    const result = computeHealthScore([], configs, NOW);
    expect(result).toBe(0);
  });

  it("skips disabled configs", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 50, enabled: true }),
      makeConfig({ signalName: "deal_velocity", weight: 50, enabled: false }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 60 }),
      makeSignal({ name: "deal_velocity", value: 100 }),
    ];

    // Only activity_recency is enabled, so score = 60
    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(60);
  });

  it("clamps score to 0 minimum", () => {
    // Signal value of 0 with decay should still be 0
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "activity_recency", weight: 100 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "activity_recency", value: 0 }),
    ];

    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(0);
  });

  it("clamps score to 100 maximum", () => {
    // Even with very high values, capped at 100
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "a", weight: 100 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "a", value: 100 }),
    ];

    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBeLessThanOrEqual(100);
  });

  it("returns integer (no fractional scores)", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "a", weight: 33 }),
      makeConfig({ signalName: "b", weight: 33 }),
      makeConfig({ signalName: "c", weight: 34 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "a", value: 77 }),
      makeSignal({ name: "b", value: 88 }),
      makeSignal({ name: "c", value: 55 }),
    ];

    const result = computeHealthScore(signals, configs, NOW);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("handles single config with single signal", () => {
    const configs: SignalConfig[] = [
      makeConfig({ signalName: "only_signal", weight: 100 }),
    ];
    const signals: SignalInput[] = [
      makeSignal({ name: "only_signal", value: 42 }),
    ];

    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(42);
  });

  it("handles very large number of configs without error", () => {
    const configs: SignalConfig[] = Array.from({ length: 50 }, (_, i) =>
      makeConfig({ signalName: `signal_${i}`, weight: 2 }),
    );
    const signals: SignalInput[] = Array.from({ length: 50 }, (_, i) =>
      makeSignal({ name: `signal_${i}`, value: 75 }),
    );

    const result = computeHealthScore(signals, configs, NOW);
    expect(result).toBe(75);
  });
});
