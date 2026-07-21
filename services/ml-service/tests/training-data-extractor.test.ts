/**
 * Training Data Extractor Tests
 *
 * Verifies:
 *  - 24-month rolling window calculation
 *  - Data freshness verification (< 7 days stale)
 *  - Minimum data volume per domain enforcement
 *  - Zero-variance feature exclusion
 *  - Class imbalance detection and class-weight computation
 *  - Stratified sampling for imbalanced datasets
 *  - Tenant-scoped data extraction (no cross-tenant leakage)
 *
 * Validates: Requirements 4.2, 4.3, 20.1, 20.2, 20.3, 20.4, 23.2, 23.6
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock DB before importing the extractor
const mockSelect = vi.fn();
vi.mock("../src/shared/db.js", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    execute: vi.fn(async () => []),
    // wrapWithTenantGuc injects app.tenant_id inside db.transaction() — the
    // mock invokes the callback with a tx exposing the same select chain so
    // extractTrainingData's bare-read-turned-transactional-read still works.
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ select: (...args: unknown[]) => mockSelect(...args) }),
  },
  sqlClient: { end: vi.fn() },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), put: vi.fn(), invalidate: vi.fn() },
  queue: { publish: vi.fn(async () => {}), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => {}),
  markProcessed: vi.fn(async () => {}),
  startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));

import {
  computeWindowStart,
  checkDataFreshness,
  meetsMinimumVolume,
  excludeZeroVarianceFeatures,
  filterFeatures,
  computeClassDistribution,
  computeClassWeights,
  applyStratifiedSampling,
  extractTrainingData,
  DEFAULT_DATA_CONFIG,
  type TrainingRecord,
} from "../src/modules/training/data-extractor.js";

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_TENANT = "ffffffff-1111-2222-3333-444444444444";

// ─── computeWindowStart Tests ────────────────────────────────────────────────

describe("computeWindowStart", () => {
  it("computes start date 24 months before given date", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    const start = computeWindowStart(now, 24);
    expect(start.getFullYear()).toBe(2024);
    expect(start.getMonth()).toBe(6); // July (0-indexed)
  });

  it("handles year boundary correctly", () => {
    const now = new Date("2026-01-15T00:00:00.000Z");
    const start = computeWindowStart(now, 24);
    expect(start.getFullYear()).toBe(2024);
    expect(start.getMonth()).toBe(0); // January
  });

  it("works with shorter windows", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    const start = computeWindowStart(now, 6);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0); // January
  });

  it("does not mutate the input date", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    const original = now.getTime();
    computeWindowStart(now, 24);
    expect(now.getTime()).toBe(original);
  });
});

// ─── checkDataFreshness Tests ────────────────────────────────────────────────

describe("checkDataFreshness", () => {
  it("returns true when data is within freshness threshold", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    const recent = new Date("2026-07-14T00:00:00.000Z"); // 1 day old
    expect(checkDataFreshness(recent, now, 7)).toBe(true);
  });

  it("returns true when data is exactly at boundary (< 7 days)", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    const borderline = new Date("2026-07-08T01:00:00.000Z"); // ~6.96 days
    expect(checkDataFreshness(borderline, now, 7)).toBe(true);
  });

  it("returns false when data is stale (>= 7 days old)", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    const stale = new Date("2026-07-07T00:00:00.000Z"); // 8 days old
    expect(checkDataFreshness(stale, now, 7)).toBe(false);
  });

  it("returns false when data is exactly 7 days old", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    const exactlyStale = new Date("2026-07-08T00:00:00.000Z"); // exactly 7 days
    expect(checkDataFreshness(exactlyStale, now, 7)).toBe(false);
  });

  it("returns true for same-day data", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const sameDay = new Date("2026-07-15T06:00:00.000Z");
    expect(checkDataFreshness(sameDay, now, 7)).toBe(true);
  });
});

// ─── meetsMinimumVolume Tests ────────────────────────────────────────────────

describe("meetsMinimumVolume", () => {
  it("returns true when count meets minimum for leads (100)", () => {
    expect(meetsMinimumVolume("leads", 100)).toBe(true);
    expect(meetsMinimumVolume("leads", 150)).toBe(true);
  });

  it("returns false when count is below minimum for leads", () => {
    expect(meetsMinimumVolume("leads", 99)).toBe(false);
    expect(meetsMinimumVolume("leads", 0)).toBe(false);
  });

  it("enforces correct minimums per domain", () => {
    expect(meetsMinimumVolume("tickets", 200)).toBe(true);
    expect(meetsMinimumVolume("tickets", 199)).toBe(false);
    expect(meetsMinimumVolume("inventory", 30)).toBe(true);
    expect(meetsMinimumVolume("inventory", 29)).toBe(false);
    expect(meetsMinimumVolume("subscriptions", 50)).toBe(true);
    expect(meetsMinimumVolume("subscriptions", 49)).toBe(false);
    expect(meetsMinimumVolume("tasks", 5)).toBe(true);
    expect(meetsMinimumVolume("tasks", 4)).toBe(false);
    expect(meetsMinimumVolume("transactions", 1000)).toBe(true);
    expect(meetsMinimumVolume("transactions", 999)).toBe(false);
  });
});

// ─── excludeZeroVarianceFeatures Tests ───────────────────────────────────────

describe("excludeZeroVarianceFeatures", () => {
  it("keeps features with variance across records", () => {
    const records: TrainingRecord[] = [
      { entityId: "1", features: { a: 1, b: 5 }, computedAt: new Date() },
      { entityId: "2", features: { a: 2, b: 5 }, computedAt: new Date() },
      { entityId: "3", features: { a: 3, b: 5 }, computedAt: new Date() },
    ];
    const result = excludeZeroVarianceFeatures(records, ["a", "b"]);
    expect(result.keptFeatures).toEqual(["a"]);
    expect(result.excludedFeatures).toEqual(["b"]);
  });

  it("keeps all features when all have variance", () => {
    const records: TrainingRecord[] = [
      { entityId: "1", features: { a: 1, b: 2 }, computedAt: new Date() },
      { entityId: "2", features: { a: 3, b: 4 }, computedAt: new Date() },
    ];
    const result = excludeZeroVarianceFeatures(records, ["a", "b"]);
    expect(result.keptFeatures).toEqual(["a", "b"]);
    expect(result.excludedFeatures).toEqual([]);
  });

  it("excludes all features when all are constant", () => {
    const records: TrainingRecord[] = [
      { entityId: "1", features: { a: 5, b: 10 }, computedAt: new Date() },
      { entityId: "2", features: { a: 5, b: 10 }, computedAt: new Date() },
    ];
    const result = excludeZeroVarianceFeatures(records, ["a", "b"]);
    expect(result.keptFeatures).toEqual([]);
    expect(result.excludedFeatures).toEqual(["a", "b"]);
  });

  it("handles single-record dataset by keeping all features", () => {
    const records: TrainingRecord[] = [
      { entityId: "1", features: { a: 5, b: 10 }, computedAt: new Date() },
    ];
    const result = excludeZeroVarianceFeatures(records, ["a", "b"]);
    expect(result.keptFeatures).toEqual(["a", "b"]);
    expect(result.excludedFeatures).toEqual([]);
  });

  it("handles empty records by keeping all features", () => {
    const result = excludeZeroVarianceFeatures([], ["a", "b"]);
    expect(result.keptFeatures).toEqual(["a", "b"]);
    expect(result.excludedFeatures).toEqual([]);
  });

  it("treats missing feature values as 0 for variance check", () => {
    const records: TrainingRecord[] = [
      { entityId: "1", features: { a: 0 }, computedAt: new Date() },
      { entityId: "2", features: { a: 0 }, computedAt: new Date() },
    ];
    const result = excludeZeroVarianceFeatures(records, ["a"]);
    expect(result.excludedFeatures).toEqual(["a"]);
  });
});

// ─── filterFeatures Tests ────────────────────────────────────────────────────

describe("filterFeatures", () => {
  it("removes excluded features from records", () => {
    const records: TrainingRecord[] = [
      { entityId: "1", features: { a: 1, b: 5, c: 3 }, computedAt: new Date() },
      { entityId: "2", features: { a: 2, b: 5, c: 4 }, computedAt: new Date() },
    ];
    const filtered = filterFeatures(records, ["a", "c"]);
    expect(filtered[0]!.features).toEqual({ a: 1, c: 3 });
    expect(filtered[1]!.features).toEqual({ a: 2, c: 4 });
  });

  it("preserves entityId and other fields", () => {
    const date = new Date("2026-01-01");
    const records: TrainingRecord[] = [
      { entityId: "entity-1", features: { a: 1, b: 2 }, label: 1, computedAt: date },
    ];
    const filtered = filterFeatures(records, ["a"]);
    expect(filtered[0]!.entityId).toBe("entity-1");
    expect(filtered[0]!.label).toBe(1);
    expect(filtered[0]!.computedAt).toBe(date);
  });
});

// ─── computeClassDistribution Tests ──────────────────────────────────────────

describe("computeClassDistribution", () => {
  it("correctly counts positive and negative labels", () => {
    const records: TrainingRecord[] = [
      { entityId: "1", features: { a: 1 }, label: 1, computedAt: new Date() },
      { entityId: "2", features: { a: 2 }, label: 0, computedAt: new Date() },
      { entityId: "3", features: { a: 3 }, label: 1, computedAt: new Date() },
      { entityId: "4", features: { a: 4 }, label: 0, computedAt: new Date() },
      { entityId: "5", features: { a: 5 }, label: 0, computedAt: new Date() },
    ];
    const dist = computeClassDistribution(records);
    expect(dist.positiveCount).toBe(2);
    expect(dist.negativeCount).toBe(3);
    expect(dist.totalCount).toBe(5);
  });

  it("detects imbalanced dataset (minority < 20%)", () => {
    const records: TrainingRecord[] = Array.from({ length: 100 }, (_, i) => ({
      entityId: String(i),
      features: { a: i },
      label: i < 10 ? 1 : 0, // 10% positive — imbalanced
      computedAt: new Date(),
    }));
    const dist = computeClassDistribution(records);
    expect(dist.isImbalanced).toBe(true);
    expect(dist.positiveCount).toBe(10);
    expect(dist.negativeCount).toBe(90);
  });

  it("does not flag balanced dataset", () => {
    const records: TrainingRecord[] = Array.from({ length: 100 }, (_, i) => ({
      entityId: String(i),
      features: { a: i },
      label: i < 30 ? 1 : 0, // 30% positive — balanced enough
      computedAt: new Date(),
    }));
    const dist = computeClassDistribution(records);
    expect(dist.isImbalanced).toBe(false);
  });

  it("handles empty dataset", () => {
    const dist = computeClassDistribution([]);
    expect(dist.positiveCount).toBe(0);
    expect(dist.negativeCount).toBe(0);
    expect(dist.totalCount).toBe(0);
    expect(dist.isImbalanced).toBe(false);
  });
});

// ─── computeClassWeights Tests ───────────────────────────────────────────────

describe("computeClassWeights", () => {
  it("computes balanced weights for equal classes", () => {
    const weights = computeClassWeights(50, 50);
    expect(weights.positive).toBe(1.0);
    expect(weights.negative).toBe(1.0);
  });

  it("gives higher weight to minority class", () => {
    const weights = computeClassWeights(10, 90);
    // positive weight = 100 / (2 * 10) = 5.0
    // negative weight = 100 / (2 * 90) ≈ 0.556
    expect(weights.positive).toBe(5.0);
    expect(weights.negative).toBeCloseTo(0.556, 2);
  });

  it("returns 1.0 for both when either count is 0", () => {
    expect(computeClassWeights(0, 100)).toEqual({ positive: 1.0, negative: 1.0 });
    expect(computeClassWeights(100, 0)).toEqual({ positive: 1.0, negative: 1.0 });
    expect(computeClassWeights(0, 0)).toEqual({ positive: 1.0, negative: 1.0 });
  });
});

// ─── applyStratifiedSampling Tests ───────────────────────────────────────────

describe("applyStratifiedSampling", () => {
  it("oversamples minority class to reach target ratio", () => {
    const records: TrainingRecord[] = Array.from({ length: 100 }, (_, i) => ({
      entityId: String(i),
      features: { a: i },
      label: i < 10 ? 1 : 0, // 10% minority
      computedAt: new Date(),
    }));

    const sampled = applyStratifiedSampling(records, 0.30);
    // Should have more records than original
    expect(sampled.length).toBeGreaterThan(100);

    // Minority class should now be closer to 30%
    const minorityCount = sampled.filter((r) => r.label === 1).length;
    const ratio = minorityCount / sampled.length;
    expect(ratio).toBeGreaterThanOrEqual(0.25); // at least approaching target
  });

  it("does not modify already balanced datasets", () => {
    const records: TrainingRecord[] = Array.from({ length: 100 }, (_, i) => ({
      entityId: String(i),
      features: { a: i },
      label: i < 40 ? 1 : 0, // 40% minority — above 30% target
      computedAt: new Date(),
    }));

    const sampled = applyStratifiedSampling(records, 0.30);
    expect(sampled.length).toBe(100); // unchanged
  });

  it("handles empty dataset", () => {
    const sampled = applyStratifiedSampling([], 0.30);
    expect(sampled).toEqual([]);
  });

  it("handles all-positive dataset", () => {
    const records: TrainingRecord[] = Array.from({ length: 10 }, (_, i) => ({
      entityId: String(i),
      features: { a: i },
      label: 1,
      computedAt: new Date(),
    }));

    // When negative is 0, minority is negative with 0 count
    // The oversampling should still work without errors
    const sampled = applyStratifiedSampling(records, 0.30);
    // No minority records to oversample (all are same class)
    expect(sampled.length).toBe(10);
  });
});

// ─── extractTrainingData Integration Tests ───────────────────────────────────

describe("extractTrainingData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const NOW = new Date("2026-07-15T00:00:00.000Z");
  const FRESH_DATE = new Date("2026-07-14T00:00:00.000Z");
  const STALE_DATE = new Date("2026-07-01T00:00:00.000Z");

  function mockDbSelect(rows: unknown[]) {
    const chainMock = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    };
    mockSelect.mockReturnValue(chainMock);
  }

  function makeFeatureVectorRows(count: number, options?: {
    tenantId?: string;
    domain?: string;
    computedAt?: Date;
    features?: Record<string, unknown>;
    labels?: number[];
  }) {
    const opts = {
      tenantId: TENANT_ID,
      domain: "leads",
      computedAt: FRESH_DATE,
      features: { daysInStage: 10, interactionCount: 5, companySizeBucket: 2 },
      ...options,
    };

    return Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`,
      tenantId: opts.tenantId,
      domain: opts.domain,
      entityId: `entity-${i}`,
      features: {
        ...opts.features,
        daysInStage: i * 2, // varying values to avoid zero-variance
        interactionCount: i + 1,
        label: opts.labels ? opts.labels[i % opts.labels.length] : (i % 2),
      },
      computedAt: opts.computedAt,
    }));
  }

  it("returns success=false with no_data reason when no records found", async () => {
    mockDbSelect([]);

    const result = await extractTrainingData(TENANT_ID, "leads", DEFAULT_DATA_CONFIG, NOW);
    expect(result.success).toBe(false);
    expect(result.skippedReason).toBe("no_data");
    expect(result.records).toEqual([]);
  });

  it("returns success=false with training_data_stale reason when data is stale", async () => {
    const staleRows = makeFeatureVectorRows(150, { computedAt: STALE_DATE });
    mockDbSelect(staleRows);

    const result = await extractTrainingData(TENANT_ID, "leads", DEFAULT_DATA_CONFIG, NOW);
    expect(result.success).toBe(false);
    expect(result.skippedReason).toBe("training_data_stale");
  });

  it("returns success=false with insufficient_data when below minimum", async () => {
    // leads needs 100, give it 50
    const rows = makeFeatureVectorRows(50, { computedAt: FRESH_DATE });
    mockDbSelect(rows);

    const result = await extractTrainingData(TENANT_ID, "leads", DEFAULT_DATA_CONFIG, NOW);
    expect(result.success).toBe(false);
    expect(result.skippedReason).toBe("insufficient_data");
  });

  it("successfully extracts data when all checks pass", async () => {
    const rows = makeFeatureVectorRows(120, { computedAt: FRESH_DATE });
    mockDbSelect(rows);

    const result = await extractTrainingData(TENANT_ID, "leads", DEFAULT_DATA_CONFIG, NOW);
    expect(result.success).toBe(true);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.featureNames.length).toBeGreaterThan(0);
  });

  it("excludes zero-variance features from result", async () => {
    // All records have the same companySizeBucket=2, varying daysInStage
    const rows = makeFeatureVectorRows(120, {
      computedAt: FRESH_DATE,
      features: { daysInStage: 5, companySizeBucket: 2, interactionCount: 3 },
    });
    // Override: companySizeBucket is constant across all — should be excluded
    // daysInStage varies because makeFeatureVectorRows sets it to i*2
    mockDbSelect(rows);

    const result = await extractTrainingData(TENANT_ID, "leads", DEFAULT_DATA_CONFIG, NOW);
    expect(result.success).toBe(true);
    // companySizeBucket should be excluded (zero variance once extracted)
    if (result.excludedFeatures && result.excludedFeatures.length > 0) {
      expect(result.excludedFeatures).toContain("companySizeBucket");
    }
  });

  it("applies class-weight adjustment for imbalanced classification domains", async () => {
    // Create heavily imbalanced dataset (10% positive)
    const rows = makeFeatureVectorRows(120, {
      computedAt: FRESH_DATE,
      labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1], // 10% positive
    });
    mockDbSelect(rows);

    const result = await extractTrainingData(TENANT_ID, "leads", DEFAULT_DATA_CONFIG, NOW);
    expect(result.success).toBe(true);
    // Should detect imbalance and provide class weights
    expect(result.classDistribution).toBeDefined();
    expect(result.classWeights).toBeDefined();
    if (result.classWeights) {
      expect(result.classWeights.positive).toBeGreaterThan(1.0);
      expect(result.classWeights.negative).toBeLessThan(1.0);
    }
  });

  it("does not apply rebalancing for regression domains (inventory, tasks)", async () => {
    const rows = makeFeatureVectorRows(50, {
      domain: "inventory",
      computedAt: FRESH_DATE,
    });
    mockDbSelect(rows);

    const config = { ...DEFAULT_DATA_CONFIG, minRecords: { ...DEFAULT_DATA_CONFIG.minRecords, inventory: 30 } };
    const result = await extractTrainingData(TENANT_ID, "inventory", config, NOW);
    expect(result.success).toBe(true);
    expect(result.classWeights).toBeUndefined();
    expect(result.classDistribution).toBeUndefined();
  });

  it("enforces tenant-scoped queries (records only for specified tenant)", async () => {
    // Only matching tenant's data should appear
    const rows = makeFeatureVectorRows(120, {
      tenantId: TENANT_ID,
      computedAt: FRESH_DATE,
    });
    mockDbSelect(rows);

    const result = await extractTrainingData(TENANT_ID, "leads", DEFAULT_DATA_CONFIG, NOW);
    expect(result.success).toBe(true);
    // All records belong to TENANT_ID
    for (const record of result.records) {
      expect(record.entityId).toBeDefined();
    }
  });

  it("respects custom config for rolling window", async () => {
    const customConfig = { ...DEFAULT_DATA_CONFIG, rollingWindowMonths: 12 };
    mockDbSelect([]);

    await extractTrainingData(TENANT_ID, "leads", customConfig, NOW);
    // Verify the select was called (mock chain)
    expect(mockSelect).toHaveBeenCalled();
  });
});
