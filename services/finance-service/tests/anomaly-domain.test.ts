/**
 * Anomaly Detection Domain — pure unit tests.
 *
 * Source: services/finance-service/src/modules/anomaly/domain.ts
 * Covers:
 *   1. classifySeverity — Z-score threshold classification
 *   2. scoreTransactionZScore — transaction scoring against rolling stats
 *   3. scoreCostCenterPattern — cost center spend pattern (>2 stddev)
 *   4. scoreUserBehavior — personal baseline deviation (>3 stddev)
 *   5. detectAnomalies — multi-check orchestration
 *   6. isDismissed — prevents re-flagging
 *   7. Edge cases: zero std, boundary values, large paise amounts
 *
 * Test pack: erp-ai-test-prompts/Finance_Module_Test_Pack/02_Anomaly_Module_Test_Pack.md
 */
import { describe, it, expect } from "vitest";
import {
  classifySeverity,
  scoreTransactionZScore,
  scoreCostCenterPattern,
  scoreUserBehavior,
  detectAnomalies,
  isDismissed,
  type RollingStats,
  type TransactionData,
} from "../src/modules/anomaly/domain.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-0001-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0001-4000-8000-000000000002";

function makeTransaction(overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    id: "txn-001",
    tenantId: TENANT_A,
    amountPaise: 100_000n, // Rs 1,000
    categoryId: "cat-office",
    vendorId: "vendor-001",
    costCenterId: "cc-001",
    userId: "user-001",
    date: new Date("2026-07-15"),
    description: "Office supplies",
    ...overrides,
  };
}

function makeStats(mean: number, std: number, count = 50): RollingStats {
  return { mean, std, count };
}

// ─── 1. classifySeverity ─────────────────────────────────────────────────────

describe("classifySeverity — Z-score threshold classification", () => {
  it("returns 'high' for Z > 5", () => {
    expect(classifySeverity(5.1)).toBe("high");
    expect(classifySeverity(10)).toBe("high");
    expect(classifySeverity(100)).toBe("high");
  });

  it("returns 'medium' for Z >= 3 and <= 5", () => {
    expect(classifySeverity(3)).toBe("medium");
    expect(classifySeverity(4)).toBe("medium");
    expect(classifySeverity(5)).toBe("medium");
  });

  it("returns 'low' for Z < 3", () => {
    expect(classifySeverity(2.9)).toBe("low");
    expect(classifySeverity(0)).toBe("low");
    expect(classifySeverity(1)).toBe("low");
  });

  it("boundary: exactly 5 is medium, 5.001 is high", () => {
    expect(classifySeverity(5)).toBe("medium");
    expect(classifySeverity(5.001)).toBe("high");
  });

  it("boundary: exactly 3 is medium, 2.999 is low", () => {
    expect(classifySeverity(3)).toBe("medium");
    expect(classifySeverity(2.999)).toBe("low");
  });
});

// ─── 2. scoreTransactionZScore ───────────────────────────────────────────────

describe("scoreTransactionZScore — transaction scoring", () => {
  it("returns null when Z-score <= 3 (no anomaly)", () => {
    // Amount 100_000 paise, mean 100_000, std 10_000 → Z = 0
    const result = scoreTransactionZScore(100_000n, makeStats(100_000, 10_000));
    expect(result).toBeNull();
  });

  it("returns null when std is 0 (no variance)", () => {
    const result = scoreTransactionZScore(999_999n, makeStats(100_000, 0));
    expect(result).toBeNull();
  });

  it("detects positive anomaly (high amount)", () => {
    // Amount 200_000, mean 100_000, std 10_000 → Z = 10 (high)
    const result = scoreTransactionZScore(200_000n, makeStats(100_000, 10_000));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
    expect(result!.zScore).toBeCloseTo(10, 1);
    expect(result!.factors.length).toBeGreaterThan(0);
    expect(result!.factors[0]!.direction).toBe("positive");
  });

  it("detects negative anomaly (unusually low amount)", () => {
    // Amount 50_000, mean 100_000, std 10_000 → Z = -5 (medium/high boundary)
    const result = scoreTransactionZScore(50_000n, makeStats(100_000, 10_000));
    expect(result).not.toBeNull();
    expect(result!.zScore).toBeCloseTo(-5, 1);
    expect(result!.factors[0]!.direction).toBe("negative");
  });

  it("boundary: Z-score exactly 3 → no anomaly (threshold is >3)", () => {
    // Amount 130_000, mean 100_000, std 10_000 → Z = 3.0
    const result = scoreTransactionZScore(130_000n, makeStats(100_000, 10_000));
    expect(result).toBeNull();
  });

  it("boundary: Z-score 3.01 → anomaly detected", () => {
    // Amount 130_100, mean 100_000, std 10_000 → Z = 3.01
    const result = scoreTransactionZScore(130_100n, makeStats(100_000, 10_000));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("medium");
  });

  it("includes amount_deviation and rolling_90d_mean factors", () => {
    const result = scoreTransactionZScore(200_000n, makeStats(100_000, 10_000));
    expect(result).not.toBeNull();
    const features = result!.factors.map((f) => f.feature);
    expect(features).toContain("amount_deviation");
    expect(features).toContain("rolling_90d_mean");
  });
});

// ─── 3. scoreCostCenterPattern ───────────────────────────────────────────────

describe("scoreCostCenterPattern — cost center spend (>2 stddev)", () => {
  it("returns null when deviation <= 2 stddev", () => {
    // Spend 120, mean 100, std 10 → Z = 2.0 (not flagged)
    const result = scoreCostCenterPattern(120, makeStats(100, 10));
    expect(result).toBeNull();
  });

  it("flags when deviation > 2 stddev", () => {
    // Spend 130, mean 100, std 10 → Z = 3.0 (flagged, medium)
    const result = scoreCostCenterPattern(130, makeStats(100, 10));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("medium");
  });

  it("returns null when std is 0", () => {
    const result = scoreCostCenterPattern(999, makeStats(100, 0));
    expect(result).toBeNull();
  });

  it("boundary: Z = 2.0 → no flag; Z = 2.01 → flag", () => {
    expect(scoreCostCenterPattern(120, makeStats(100, 10))).toBeNull();
    expect(scoreCostCenterPattern(120.1, makeStats(100, 10))).not.toBeNull();
  });

  it("flags negative deviation (under-spend) when > 2 stddev below mean", () => {
    // Spend 70, mean 100, std 10 → Z = -3.0
    const result = scoreCostCenterPattern(70, makeStats(100, 10));
    expect(result).not.toBeNull();
    expect(result!.factors[0]!.direction).toBe("negative");
  });
});

// ─── 4. scoreUserBehavior ────────────────────────────────────────────────────

describe("scoreUserBehavior — personal baseline (>3 stddev)", () => {
  it("returns null when within 3 stddev", () => {
    const result = scoreUserBehavior(130, makeStats(100, 10), "volume");
    expect(result).toBeNull(); // Z = 3.0, threshold is >3
  });

  it("flags when > 3 stddev from personal baseline", () => {
    const result = scoreUserBehavior(131, makeStats(100, 10), "volume");
    expect(result).not.toBeNull();
    expect(result!.factors[0]!.feature).toBe("user_volume_deviation");
  });

  it("handles amount metric", () => {
    const result = scoreUserBehavior(200, makeStats(100, 10), "amount");
    expect(result).not.toBeNull();
    expect(result!.factors[0]!.feature).toBe("user_amount_deviation");
  });

  it("handles timing metric", () => {
    const result = scoreUserBehavior(200, makeStats(100, 10), "timing");
    expect(result).not.toBeNull();
    expect(result!.factors[0]!.feature).toBe("user_timing_deviation");
  });

  it("returns null when std is 0 (consistent user)", () => {
    const result = scoreUserBehavior(999, makeStats(100, 0), "volume");
    expect(result).toBeNull();
  });
});

// ─── 5. detectAnomalies — multi-check orchestration ──────────────────────────

describe("detectAnomalies — composite detection", () => {
  it("returns empty array when no stats available", () => {
    const txn = makeTransaction();
    const result = detectAnomalies(txn, null, null, null, null);
    expect(result).toEqual([]);
  });

  it("returns Z-score anomaly when triggered", () => {
    const txn = makeTransaction({ amountPaise: 200_000n });
    const stats = makeStats(100_000, 10_000);
    const result = detectAnomalies(txn, stats, null, null, null);
    expect(result.length).toBe(1);
    expect(result[0]!.anomalyType).toBe("zscore");
    expect(result[0]!.transactionId).toBe("txn-001");
    expect(result[0]!.vendorId).toBe("vendor-001");
  });

  it("returns cost center anomaly when triggered", () => {
    const txn = makeTransaction();
    const ccStats = makeStats(100_000, 10_000);
    const result = detectAnomalies(txn, null, ccStats, 200_000, null);
    expect(result.length).toBe(1);
    expect(result[0]!.anomalyType).toBe("cost_center_pattern");
  });

  it("returns user behavior anomalies (volume + amount)", () => {
    const txn = makeTransaction();
    const userStats = {
      volume: makeStats(5, 1),
      amount: makeStats(50_000, 5_000),
    };
    const userValues = { volume: 20, amount: 200_000 };
    const result = detectAnomalies(txn, null, null, null, userStats, userValues);
    expect(result.length).toBe(2);
    expect(result.some((a) => a.anomalyType === "user_behavior")).toBe(true);
  });

  it("can return multiple anomaly types for one transaction", () => {
    const txn = makeTransaction({ amountPaise: 500_000n });
    const categoryStats = makeStats(100_000, 10_000);
    const ccStats = makeStats(100_000, 10_000);
    const result = detectAnomalies(txn, categoryStats, ccStats, 500_000, null);
    expect(result.length).toBe(2);
    const types = result.map((a) => a.anomalyType);
    expect(types).toContain("zscore");
    expect(types).toContain("cost_center_pattern");
  });

  it("carries amount as string (paise)", () => {
    const txn = makeTransaction({ amountPaise: 12_345_678n });
    const stats = makeStats(100, 10); // will definitely trigger at 12M
    const result = detectAnomalies(txn, stats, null, null, null);
    expect(result[0]!.amountPaise).toBe("12345678");
  });
});

// ─── 6. isDismissed ──────────────────────────────────────────────────────────

describe("isDismissed — prevents re-flagging", () => {
  it("returns true for dismissed status", () => {
    expect(isDismissed("dismissed")).toBe(true);
  });

  it("returns false for open status", () => {
    expect(isDismissed("open")).toBe(false);
  });

  it("returns false for reviewed status", () => {
    expect(isDismissed("reviewed")).toBe(false);
  });

  it("returns false for undefined (new transaction)", () => {
    expect(isDismissed(undefined)).toBe(false);
  });
});

// ─── 7. AI alerts never auto-block/reverse (design verification) ─────────────

describe("design invariant: AI anomalies are advisory-only", () => {
  it("detectAnomalies returns data structures only — no side effects", () => {
    // The function is pure: takes data, returns anomalies. No DB, no queue, no
    // blocking action. The actual flag creation is in the consumer (separate layer).
    const txn = makeTransaction({ amountPaise: 999_999n });
    const stats = makeStats(100, 10);
    const result = detectAnomalies(txn, stats, null, null, null);
    // Result is just data — never a blocking/reversal action
    expect(Array.isArray(result)).toBe(true);
    for (const a of result) {
      expect(a).toHaveProperty("transactionId");
      expect(a).toHaveProperty("severity");
      expect(a).not.toHaveProperty("block");
      expect(a).not.toHaveProperty("reverse");
      expect(a).not.toHaveProperty("reject");
    }
  });
});
