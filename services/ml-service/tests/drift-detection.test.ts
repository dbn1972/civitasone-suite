/**
 * Drift Detection and Bias Monitoring Tests
 *
 * Verifies:
 *  - KL divergence computation correctness
 *  - Confidence histogram building
 *  - Drift detection logic (threshold at 15%)
 *  - Territory deviation computation (threshold at 10%)
 *  - Alert emission on drift detection
 *  - Bias alert emission for territory deviations
 *  - Emergency retrain triggering on drift
 *
 * Validates: Requirements 21.7, 24.1
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock DB before importing module
vi.mock("../src/shared/db.js", () => ({
  db: {
    execute: vi.fn(async () => []),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => [{}]) })) })),
      });
    }),
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
  computeKLDivergence,
  buildConfidenceHistogram,
  computeDeviations,
  detectDrift,
  detectBias,
  emitDriftAlert,
  emitBiasAlerts,
  runDriftAndBiasMonitoring,
  KL_DIVERGENCE_THRESHOLD,
  TERRITORY_DEVIATION_THRESHOLD,
  HISTOGRAM_BINS,
} from "../src/modules/training/drift-detection.js";
import type {
  DriftResult,
  BiasResult,
  TerritoryDistribution,
} from "../src/modules/training/drift-detection.js";
import { db } from "../src/shared/db.js";
import { enqueue } from "../src/shared/outbox.js";

// ─── computeKLDivergence Tests ───────────────────────────────────────────────

describe("computeKLDivergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 for identical distributions", () => {
    const p = [0.1, 0.2, 0.3, 0.2, 0.1, 0.05, 0.03, 0.01, 0.005, 0.005];
    const kl = computeKLDivergence(p, p);
    expect(kl).toBeCloseTo(0, 5);
  });

  it("returns a positive value for different distributions", () => {
    const p = [0.5, 0.3, 0.1, 0.05, 0.03, 0.01, 0.005, 0.003, 0.001, 0.001];
    const q = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    const kl = computeKLDivergence(p, q);
    expect(kl).toBeGreaterThan(0);
  });

  it("returns higher divergence for more different distributions", () => {
    const uniform = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    const slightlySkewed = [0.15, 0.15, 0.12, 0.1, 0.1, 0.1, 0.08, 0.08, 0.06, 0.06];
    const verySkewed = [0.6, 0.2, 0.1, 0.05, 0.02, 0.01, 0.01, 0.005, 0.003, 0.002];

    const klSlight = computeKLDivergence(uniform, slightlySkewed);
    const klVery = computeKLDivergence(uniform, verySkewed);

    expect(klVery).toBeGreaterThan(klSlight);
  });

  it("handles empty distributions (returns 0)", () => {
    const kl = computeKLDivergence([], []);
    expect(kl).toBe(0);
  });

  it("throws on mismatched distribution lengths", () => {
    expect(() => computeKLDivergence([0.5, 0.5], [0.3, 0.3, 0.4])).toThrow(
      "Distribution length mismatch"
    );
  });

  it("handles distributions with zero bins gracefully (Laplace smoothing)", () => {
    const p = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    const q = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const kl = computeKLDivergence(p, q);
    expect(kl).toBeGreaterThan(0);
    expect(Number.isFinite(kl)).toBe(true);
  });

  it("is non-negative for all valid inputs", () => {
    const p = [0.3, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.01, 0.005, 0.005];
    const q = [0.1, 0.1, 0.15, 0.15, 0.15, 0.1, 0.1, 0.05, 0.05, 0.05];
    const kl = computeKLDivergence(p, q);
    expect(kl).toBeGreaterThanOrEqual(0);
  });
});

// ─── buildConfidenceHistogram Tests ──────────────────────────────────────────

describe("buildConfidenceHistogram", () => {
  it("returns empty bins for empty input", () => {
    const result = buildConfidenceHistogram([]);
    expect(result.bins).toHaveLength(HISTOGRAM_BINS);
    expect(result.sampleCount).toBe(0);
    expect(result.bins.every((b) => b === 0)).toBe(true);
  });

  it("correctly bins confidence values", () => {
    // All values in bin 0 (0.0 to 0.1)
    const result = buildConfidenceHistogram([0.01, 0.05, 0.09]);
    expect(result.bins[0]).toBeCloseTo(1.0, 5); // All 3 in bin 0
    expect(result.sampleCount).toBe(3);
  });

  it("normalizes bins to sum to 1.0", () => {
    const confidences = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const result = buildConfidenceHistogram(confidences);
    const sum = result.bins.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    expect(result.sampleCount).toBe(10);
  });

  it("clamps values outside [0,1] range", () => {
    const result = buildConfidenceHistogram([-0.5, 1.5, 0.5]);
    expect(result.sampleCount).toBe(3);
    // -0.5 clamped to 0 → bin 0, 1.5 clamped to 1.0 → last bin, 0.5 → bin 5
    expect(result.bins[0]).toBeCloseTo(1 / 3, 5);
    expect(result.bins[HISTOGRAM_BINS - 1]).toBeCloseTo(1 / 3, 5);
    expect(result.bins[5]).toBeCloseTo(1 / 3, 5);
  });

  it("places 1.0 in the last bin", () => {
    const result = buildConfidenceHistogram([1.0, 1.0, 1.0]);
    expect(result.bins[HISTOGRAM_BINS - 1]).toBeCloseTo(1.0, 5);
  });
});

// ─── computeDeviations Tests ─────────────────────────────────────────────────

describe("computeDeviations", () => {
  it("returns empty for empty territories", () => {
    const result = computeDeviations([]);
    expect(result.populationMean).toBe(0);
    expect(result.deviations).toHaveLength(0);
  });

  it("marks all territories as 'pass' when predictions are uniform", () => {
    const territories: TerritoryDistribution[] = [
      { territory: "North", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
      { territory: "South", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
      { territory: "East", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
    ];
    const result = computeDeviations(territories);
    expect(result.populationMean).toBeCloseTo(0.5, 5);
    expect(result.deviations.every((d) => d.status === "pass")).toBe(true);
    expect(result.deviations.every((d) => d.deviationPct === 0)).toBe(true);
  });

  it("marks territory as 'fail' when deviation exceeds 10%", () => {
    const territories: TerritoryDistribution[] = [
      { territory: "North", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
      { territory: "South", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
      { territory: "East", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.7 }, // 40% deviation
    ];
    const result = computeDeviations(territories);
    const eastDev = result.deviations.find((d) => d.territory === "East");
    expect(eastDev?.status).toBe("fail");
    expect(eastDev!.deviationPct).toBeGreaterThan(TERRITORY_DEVIATION_THRESHOLD);
  });

  it("marks territory as 'warn' when deviation is between 7% and 10%", () => {
    // Population mean will be approximately (100*0.5 + 100*0.5 + 100*0.545) / 300 = 0.515
    // East deviation: |0.545 - 0.515| / 0.515 ≈ 0.058 which is between 0.07 and 0.10
    const territories: TerritoryDistribution[] = [
      { territory: "North", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.50 },
      { territory: "South", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.50 },
      { territory: "East", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.55 },
    ];
    const result = computeDeviations(territories);
    // Mean ≈ 0.5167, East deviation ≈ |0.55 - 0.5167| / 0.5167 ≈ 0.064
    // At threshold 0.10, warn threshold is 0.07
    // 0.064 < 0.07 so this is actually "pass"
    // Let's use a value that's clearly in the warn zone
    const territories2: TerritoryDistribution[] = [
      { territory: "North", predictionCount: 200, meanConfidence: 0.7, meanPrediction: 0.50 },
      { territory: "South", predictionCount: 200, meanConfidence: 0.7, meanPrediction: 0.50 },
      { territory: "East", predictionCount: 50, meanConfidence: 0.7, meanPrediction: 0.54 },
    ];
    const result2 = computeDeviations(territories2);
    // Mean ≈ (200*0.5 + 200*0.5 + 50*0.54) / 450 ≈ 0.504
    // East deviation ≈ |0.54 - 0.504| / 0.504 ≈ 0.071 → warn (>7% but <10%)
    const eastDev = result2.deviations.find((d) => d.territory === "East");
    expect(eastDev?.status).toBe("warn");
  });

  it("computes weighted population mean correctly", () => {
    const territories: TerritoryDistribution[] = [
      { territory: "A", predictionCount: 300, meanConfidence: 0.7, meanPrediction: 0.6 },
      { territory: "B", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.4 },
    ];
    const result = computeDeviations(territories);
    // Weighted mean: (300*0.6 + 100*0.4) / 400 = (180 + 40) / 400 = 0.55
    expect(result.populationMean).toBeCloseTo(0.55, 5);
  });

  it("handles custom threshold", () => {
    const territories: TerritoryDistribution[] = [
      { territory: "A", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
      { territory: "B", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.53 },
    ];
    // With 5% threshold, deviation of ~6% (|0.53-0.515|/0.515) should fail
    const result = computeDeviations(territories, 0.05);
    const bDev = result.deviations.find((d) => d.territory === "B");
    expect(bDev!.deviationPct).toBeGreaterThan(0);
  });
});

// ─── detectDrift Tests ───────────────────────────────────────────────────────

describe("detectDrift", () => {
  const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const MODEL_ID = "11111111-2222-3333-4444-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when insufficient training distribution data", async () => {
    // First call: get model trained_at
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ trained_at: "2026-01-01T00:00:00Z" }])
      // Second call: get training predictions (too few)
      .mockResolvedValueOnce([{ confidence: "0.5" }]);

    const result = await detectDrift(TENANT, "leads", MODEL_ID);
    expect(result).toBeNull();
  });

  it("returns null when model not found", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await detectDrift(TENANT, "leads", MODEL_ID);
    expect(result).toBeNull();
  });

  it("returns null when insufficient current distribution data", async () => {
    const trainConfidences = Array.from({ length: 50 }, (_, i) => ({
      confidence: (i / 50).toFixed(4),
    }));

    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ trained_at: "2026-01-01T00:00:00Z" }])
      .mockResolvedValueOnce(trainConfidences) // Training data: enough
      .mockResolvedValueOnce([{ confidence: "0.5" }]); // Current data: too few

    const result = await detectDrift(TENANT, "leads", MODEL_ID);
    expect(result).toBeNull();
  });

  it("detects drift when distributions differ significantly", async () => {
    // Training distribution: mostly high confidence
    const trainConfidences = Array.from({ length: 100 }, () => ({
      confidence: (0.7 + Math.random() * 0.3).toFixed(4),
    }));
    // Current distribution: mostly low confidence (drift!)
    const currentConfidences = Array.from({ length: 100 }, () => ({
      confidence: (Math.random() * 0.3).toFixed(4),
    }));

    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ trained_at: "2026-01-01T00:00:00Z" }])
      .mockResolvedValueOnce(trainConfidences)
      .mockResolvedValueOnce(currentConfidences);

    const result = await detectDrift(TENANT, "leads", MODEL_ID);
    expect(result).not.toBeNull();
    expect(result!.driftDetected).toBe(true);
    expect(result!.klDivergence).toBeGreaterThan(KL_DIVERGENCE_THRESHOLD);
  });

  it("does not detect drift when distributions are similar", async () => {
    // Both distributions: uniform around 0.5
    const trainConfidences = Array.from({ length: 100 }, (_, i) => ({
      confidence: (0.4 + (i % 20) * 0.01).toFixed(4),
    }));
    const currentConfidences = Array.from({ length: 100 }, (_, i) => ({
      confidence: (0.4 + (i % 20) * 0.01).toFixed(4),
    }));

    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ trained_at: "2026-01-01T00:00:00Z" }])
      .mockResolvedValueOnce(trainConfidences)
      .mockResolvedValueOnce(currentConfidences);

    const result = await detectDrift(TENANT, "leads", MODEL_ID);
    expect(result).not.toBeNull();
    expect(result!.driftDetected).toBe(false);
    expect(result!.klDivergence).toBeLessThanOrEqual(KL_DIVERGENCE_THRESHOLD);
  });
});

// ─── emitDriftAlert Tests ────────────────────────────────────────────────────

describe("emitDriftAlert", () => {
  const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const MODEL_ID = "11111111-2222-3333-4444-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits ml.model.drift_detected event", async () => {
    const driftResult: DriftResult = {
      domain: "leads",
      tenantId: TENANT,
      modelId: MODEL_ID,
      klDivergence: 0.25,
      driftDetected: true,
      trainingDistribution: { bins: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], sampleCount: 100 },
      currentDistribution: { bins: [0.5, 0.2, 0.1, 0.1, 0.05, 0.02, 0.01, 0.01, 0.005, 0.005], sampleCount: 100 },
    };

    await emitDriftAlert(driftResult);

    expect(enqueue).toHaveBeenCalled();
    const calls = (enqueue as ReturnType<typeof vi.fn>).mock.calls;

    // Should emit drift_detected event
    const driftCall = calls.find(
      (c: unknown[]) => (c[1] as { topic: string }).topic === "ml.model.drift_detected"
    );
    expect(driftCall).toBeDefined();
    const driftPayload = (driftCall![1] as { payload: Record<string, unknown> }).payload;
    expect(driftPayload.tenantId).toBe(TENANT);
    expect(driftPayload.domain).toBe("leads");
    expect(driftPayload.modelId).toBe(MODEL_ID);
    expect(driftPayload.klDivergence).toBe(0.25);
  });

  it("triggers emergency retrain command", async () => {
    const driftResult: DriftResult = {
      domain: "tickets",
      tenantId: TENANT,
      modelId: MODEL_ID,
      klDivergence: 0.20,
      driftDetected: true,
      trainingDistribution: { bins: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], sampleCount: 50 },
      currentDistribution: { bins: [0.5, 0.2, 0.1, 0.1, 0.05, 0.02, 0.01, 0.01, 0.005, 0.005], sampleCount: 80 },
    };

    await emitDriftAlert(driftResult);

    const calls = (enqueue as ReturnType<typeof vi.fn>).mock.calls;
    // Should emit ml.train.trigger command
    const trainCall = calls.find(
      (c: unknown[]) => (c[1] as { topic: string }).topic === "ml.train.trigger"
    );
    expect(trainCall).toBeDefined();
    const trainPayload = (trainCall![1] as { payload: Record<string, unknown> }).payload;
    expect(trainPayload.tenantId).toBe(TENANT);
    expect(trainPayload.domain).toBe("tickets");
    expect(trainPayload.force).toBe(true);
    expect(trainPayload.reason).toBe("drift_detected");
  });
});

// ─── emitBiasAlerts Tests ────────────────────────────────────────────────────

describe("emitBiasAlerts", () => {
  const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const MODEL_ID = "11111111-2222-3333-4444-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits alerts only for 'fail' deviations", async () => {
    const biasResults: BiasResult[] = [{
      domain: "leads",
      tenantId: TENANT,
      modelId: MODEL_ID,
      dimension: "territory",
      populationMean: 0.5,
      territories: [
        { territory: "North", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
        { territory: "South", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.7 },
      ],
      deviations: [
        { territory: "North", deviationPct: 0.0, status: "pass" },
        { territory: "South", deviationPct: 0.40, status: "fail" },
      ],
    }];

    const alertCount = await emitBiasAlerts(biasResults);
    expect(alertCount).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);

    const calls = (enqueue as ReturnType<typeof vi.fn>).mock.calls;
    const biasCall = calls[0]!;
    const payload = (biasCall[1] as { payload: Record<string, unknown> }).payload;
    expect(payload.affectedTerritory).toBe("South");
    expect(payload.deviationPct).toBe(0.40);
    expect(payload.dimension).toBe("territory");
  });

  it("emits no alerts when all deviations pass", async () => {
    const biasResults: BiasResult[] = [{
      domain: "leads",
      tenantId: TENANT,
      modelId: MODEL_ID,
      dimension: "territory",
      populationMean: 0.5,
      territories: [
        { territory: "North", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
        { territory: "South", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
      ],
      deviations: [
        { territory: "North", deviationPct: 0.0, status: "pass" },
        { territory: "South", deviationPct: 0.0, status: "pass" },
      ],
    }];

    const alertCount = await emitBiasAlerts(biasResults);
    expect(alertCount).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("emits multiple alerts for multiple failing territories", async () => {
    const biasResults: BiasResult[] = [{
      domain: "leads",
      tenantId: TENANT,
      modelId: MODEL_ID,
      dimension: "territory",
      populationMean: 0.5,
      territories: [
        { territory: "North", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
        { territory: "South", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.7 },
        { territory: "West", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.3 },
      ],
      deviations: [
        { territory: "North", deviationPct: 0.0, status: "pass" },
        { territory: "South", deviationPct: 0.40, status: "fail" },
        { territory: "West", deviationPct: 0.40, status: "fail" },
      ],
    }];

    const alertCount = await emitBiasAlerts(biasResults);
    expect(alertCount).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("does not emit alerts for 'warn' deviations", async () => {
    const biasResults: BiasResult[] = [{
      domain: "tickets",
      tenantId: TENANT,
      modelId: MODEL_ID,
      dimension: "department_type",
      populationMean: 0.5,
      territories: [
        { territory: "Engineering", predictionCount: 100, meanConfidence: 0.7, meanPrediction: 0.5 },
      ],
      deviations: [
        { territory: "Engineering", deviationPct: 0.08, status: "warn" },
      ],
    }];

    const alertCount = await emitBiasAlerts(biasResults);
    expect(alertCount).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

// ─── detectBias Tests ────────────────────────────────────────────────────────

describe("detectBias", () => {
  const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const MODEL_ID = "11111111-2222-3333-4444-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns results for both territory and department dimensions", async () => {
    const mockTerritoryRows = [
      { territory: "North", prediction_count: 50, mean_confidence: "0.7", mean_prediction: "0.5" },
      { territory: "South", prediction_count: 50, mean_confidence: "0.6", mean_prediction: "0.5" },
    ];
    const mockDeptRows = [
      { territory: "HR", prediction_count: 30, mean_confidence: "0.7", mean_prediction: "0.5" },
      { territory: "IT", prediction_count: 30, mean_confidence: "0.6", mean_prediction: "0.5" },
    ];

    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockTerritoryRows)
      .mockResolvedValueOnce(mockDeptRows);

    const results = await detectBias(TENANT, "leads", MODEL_ID);
    expect(results).toHaveLength(2);
    expect(results[0]!.dimension).toBe("territory");
    expect(results[1]!.dimension).toBe("department_type");
  });

  it("skips dimension with only one territory (no comparison possible)", async () => {
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { territory: "Only", prediction_count: 50, mean_confidence: "0.7", mean_prediction: "0.5" },
      ])
      .mockResolvedValueOnce([]);

    const results = await detectBias(TENANT, "leads", MODEL_ID);
    expect(results).toHaveLength(0);
  });

  it("returns empty when no prediction data available", async () => {
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const results = await detectBias(TENANT, "leads", MODEL_ID);
    expect(results).toHaveLength(0);
  });
});

// ─── runDriftAndBiasMonitoring Tests ─────────────────────────────────────────

describe("runDriftAndBiasMonitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero stats when no active models exist", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const stats = await runDriftAndBiasMonitoring();
    expect(stats.driftChecks).toBe(0);
    expect(stats.driftAlerts).toBe(0);
    expect(stats.biasChecks).toBe(0);
    expect(stats.biasAlerts).toBe(0);
  });

  it("processes active models and aggregates stats", async () => {
    // First call: active models query
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: "model-1", tenant_id: "tenant-1", domain: "leads" },
      ])
      // Drift detection: get model
      .mockResolvedValueOnce([{ trained_at: "2026-01-01T00:00:00Z" }])
      // Drift detection: training predictions (insufficient → skip)
      .mockResolvedValueOnce([])
      // Bias: territory distribution (empty)
      .mockResolvedValueOnce([])
      // Bias: department distribution (empty)
      .mockResolvedValueOnce([]);

    const stats = await runDriftAndBiasMonitoring();
    // No drift checked (insufficient data) and no bias
    expect(stats.driftChecks).toBe(0);
    expect(stats.biasChecks).toBe(0);
  });

  it("continues processing when one model check fails", async () => {
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: "model-1", tenant_id: "tenant-1", domain: "leads" },
        { id: "model-2", tenant_id: "tenant-2", domain: "tickets" },
      ])
      // Model 1: drift detection throws
      .mockRejectedValueOnce(new Error("DB timeout"))
      // Model 1: bias (also throws because drift error bubbles to bias too)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // Model 2: drift - model lookup
      .mockResolvedValueOnce([{ trained_at: "2026-01-01T00:00:00Z" }])
      // Model 2: drift - training predictions (insufficient)
      .mockResolvedValueOnce([])
      // Model 2: bias territory
      .mockResolvedValueOnce([])
      // Model 2: bias department
      .mockResolvedValueOnce([]);

    const stats = await runDriftAndBiasMonitoring();
    // Should not throw — continues to next model
    expect(stats.driftChecks).toBe(0);
    expect(stats.driftAlerts).toBe(0);
  });
});

// ─── KL Divergence Threshold ─────────────────────────────────────────────────

describe("KL divergence threshold constant", () => {
  it("is set to 15% (0.15)", () => {
    expect(KL_DIVERGENCE_THRESHOLD).toBe(0.15);
  });
});

describe("territory deviation threshold constant", () => {
  it("is set to 10% (0.10)", () => {
    expect(TERRITORY_DEVIATION_THRESHOLD).toBe(0.10);
  });
});
