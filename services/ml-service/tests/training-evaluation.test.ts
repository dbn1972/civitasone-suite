/**
 * Training Evaluation Tests
 *
 * Verifies:
 *  - Domain-specific quality thresholds (AUC-ROC, precision/recall, MAPE, FPR)
 *  - Candidate vs current model comparison with 2% tolerance
 *  - Rejection when below domain threshold
 *  - Auto-deactivation after 3 consecutive failures
 *  - Event emission on promotion and deactivation
 *  - Consecutive failure tracking (increment, reset)
 *
 * Validates: Requirements 2.3, 4.4, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before imports
vi.mock("../src/shared/db.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => [{}]) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({})) })) })),
    execute: vi.fn(async () => []),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => []),
          })),
        })),
      })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => [{}]) })) })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(() => [{ id: "model-1" }]),
            })),
          })),
        })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => []),
              })),
              limit: vi.fn(() => []),
            })),
          })),
        })),
      });
    }),
  },
  sqlClient: { end: vi.fn() },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
    put: vi.fn(),
    invalidate: vi.fn(),
  },
  queue: { publish: vi.fn(async () => {}), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => {}),
  markProcessed: vi.fn(async () => {}),
  startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));

vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => {}),
}));

vi.mock("../src/modules/model-registry/domain.js", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    promote: vi.fn(async () => true),
    deactivate: vi.fn(async () => {}),
    getCurrentModel: vi.fn(async () => null),
  };
});

import {
  meetsDomainThreshold,
  meetsDemandForecastThreshold,
  evaluateCandidate,
  evaluateAndPromote,
  evaluateActiveModel,
  getConsecutiveFailureCount,
  resetConsecutiveFailures,
  incrementConsecutiveFailures,
  DOMAIN_THRESHOLDS,
  PROMOTION_TOLERANCE,
  AUTO_DEACTIVATION_THRESHOLD,
  INVENTORY_MAPE_90D_THRESHOLD,
  _consecutiveFailures,
} from "../src/modules/training/evaluation.js";
import type { ModelMetrics } from "../src/modules/model-registry/domain.js";
import {
  promote as registryPromote,
  deactivate as registryDeactivate,
  getCurrentModel,
} from "../src/modules/model-registry/domain.js";
import { enqueue } from "../src/shared/outbox.js";

// ─── Constants ───────────────────────────────────────────────────────────────

describe("evaluation constants", () => {
  it("has correct domain thresholds", () => {
    expect(DOMAIN_THRESHOLDS.leads.primaryMetric).toBe("aucRoc");
    expect(DOMAIN_THRESHOLDS.leads.threshold).toBe(0.70);
    expect(DOMAIN_THRESHOLDS.leads.direction).toBe("gte");

    expect(DOMAIN_THRESHOLDS.subscriptions.primaryMetric).toBe("aucRoc");
    expect(DOMAIN_THRESHOLDS.subscriptions.threshold).toBe(0.65);

    expect(DOMAIN_THRESHOLDS.tickets.primaryMetric).toBe("precision");
    expect(DOMAIN_THRESHOLDS.tickets.threshold).toBe(0.65);
    expect(DOMAIN_THRESHOLDS.tickets.secondary?.metric).toBe("recall");
    expect(DOMAIN_THRESHOLDS.tickets.secondary?.threshold).toBe(0.80);

    expect(DOMAIN_THRESHOLDS.inventory.primaryMetric).toBe("mape");
    expect(DOMAIN_THRESHOLDS.inventory.threshold).toBe(0.25);
    expect(DOMAIN_THRESHOLDS.inventory.direction).toBe("lte");

    expect(DOMAIN_THRESHOLDS.transactions.primaryMetric).toBe("falsePositiveRate");
    expect(DOMAIN_THRESHOLDS.transactions.threshold).toBe(0.05);
    expect(DOMAIN_THRESHOLDS.transactions.direction).toBe("lte");
  });

  it("has correct promotion tolerance of 2%", () => {
    expect(PROMOTION_TOLERANCE).toBe(0.02);
  });

  it("auto-deactivation threshold is 3", () => {
    expect(AUTO_DEACTIVATION_THRESHOLD).toBe(3);
  });

  it("inventory 90-day MAPE threshold is 0.35", () => {
    expect(INVENTORY_MAPE_90D_THRESHOLD).toBe(0.35);
  });
});

// ─── meetsDomainThreshold ────────────────────────────────────────────────────

describe("meetsDomainThreshold", () => {
  describe("leads domain (AUC-ROC ≥ 0.70)", () => {
    it("passes when AUC-ROC is at threshold", () => {
      expect(meetsDomainThreshold("leads", { aucRoc: 0.70 })).toBe(true);
    });

    it("passes when AUC-ROC exceeds threshold", () => {
      expect(meetsDomainThreshold("leads", { aucRoc: 0.85 })).toBe(true);
    });

    it("fails when AUC-ROC is below threshold", () => {
      expect(meetsDomainThreshold("leads", { aucRoc: 0.69 })).toBe(false);
    });

    it("fails when AUC-ROC is not provided", () => {
      expect(meetsDomainThreshold("leads", { accuracy: 0.90 })).toBe(false);
    });
  });

  describe("subscriptions domain (AUC-ROC ≥ 0.65)", () => {
    it("passes at threshold", () => {
      expect(meetsDomainThreshold("subscriptions", { aucRoc: 0.65 })).toBe(true);
    });

    it("fails below threshold", () => {
      expect(meetsDomainThreshold("subscriptions", { aucRoc: 0.64 })).toBe(false);
    });
  });

  describe("tickets domain (precision ≥ 0.65 AND recall ≥ 0.80)", () => {
    it("passes when both precision and recall meet thresholds", () => {
      expect(meetsDomainThreshold("tickets", { precision: 0.70, recall: 0.85 })).toBe(true);
    });

    it("passes at exact boundary values", () => {
      expect(meetsDomainThreshold("tickets", { precision: 0.65, recall: 0.80 })).toBe(true);
    });

    it("fails when precision is below threshold", () => {
      expect(meetsDomainThreshold("tickets", { precision: 0.60, recall: 0.85 })).toBe(false);
    });

    it("fails when recall is below threshold", () => {
      expect(meetsDomainThreshold("tickets", { precision: 0.70, recall: 0.75 })).toBe(false);
    });

    it("fails when recall is missing", () => {
      expect(meetsDomainThreshold("tickets", { precision: 0.70 })).toBe(false);
    });

    it("fails when precision is missing", () => {
      expect(meetsDomainThreshold("tickets", { recall: 0.85 })).toBe(false);
    });
  });

  describe("inventory domain (MAPE ≤ 0.25)", () => {
    it("passes when MAPE is at threshold", () => {
      expect(meetsDomainThreshold("inventory", { mape: 0.25 })).toBe(true);
    });

    it("passes when MAPE is below threshold (lower is better)", () => {
      expect(meetsDomainThreshold("inventory", { mape: 0.15 })).toBe(true);
    });

    it("fails when MAPE exceeds threshold", () => {
      expect(meetsDomainThreshold("inventory", { mape: 0.30 })).toBe(false);
    });
  });

  describe("transactions domain (FPR ≤ 0.05)", () => {
    it("passes when FPR is at threshold", () => {
      expect(meetsDomainThreshold("transactions", { falsePositiveRate: 0.05 })).toBe(true);
    });

    it("passes when FPR is below threshold", () => {
      expect(meetsDomainThreshold("transactions", { falsePositiveRate: 0.02 })).toBe(true);
    });

    it("fails when FPR exceeds threshold", () => {
      expect(meetsDomainThreshold("transactions", { falsePositiveRate: 0.06 })).toBe(false);
    });
  });

  describe("tasks domain (accuracy ≥ 0.60)", () => {
    it("passes when accuracy meets threshold", () => {
      expect(meetsDomainThreshold("tasks", { accuracy: 0.60 })).toBe(true);
    });

    it("fails when accuracy is below threshold", () => {
      expect(meetsDomainThreshold("tasks", { accuracy: 0.50 })).toBe(false);
    });
  });
});

// ─── meetsDemandForecastThreshold ────────────────────────────────────────────

describe("meetsDemandForecastThreshold", () => {
  it("passes when both 30d and 90d MAPE are within threshold", () => {
    expect(meetsDemandForecastThreshold({ mape: 0.20 }, 0.30)).toBe(true);
  });

  it("passes when 90d MAPE is not provided and 30d is within threshold", () => {
    expect(meetsDemandForecastThreshold({ mape: 0.20 })).toBe(true);
  });

  it("fails when 30d MAPE exceeds threshold", () => {
    expect(meetsDemandForecastThreshold({ mape: 0.30 }, 0.30)).toBe(false);
  });

  it("fails when 90d MAPE exceeds threshold", () => {
    expect(meetsDemandForecastThreshold({ mape: 0.20 }, 0.40)).toBe(false);
  });

  it("passes at exact 90d boundary", () => {
    expect(meetsDemandForecastThreshold({ mape: 0.25 }, 0.35)).toBe(true);
  });
});

// ─── evaluateCandidate ───────────────────────────────────────────────────────

describe("evaluateCandidate", () => {
  it("promotes when candidate exceeds threshold and no current model", () => {
    const result = evaluateCandidate("leads", { aucRoc: 0.85 }, null);
    expect(result).toBe("promote");
  });

  it("rejects when candidate is below domain threshold (regardless of current model)", () => {
    const result = evaluateCandidate("leads", { aucRoc: 0.60 }, { aucRoc: 0.55 });
    expect(result).toBe("reject_below_threshold");
  });

  it("promotes when candidate improves over current model", () => {
    const result = evaluateCandidate("leads", { aucRoc: 0.85 }, { aucRoc: 0.80 });
    expect(result).toBe("promote");
  });

  it("promotes when candidate is within 2% tolerance of current", () => {
    // candidate 0.79 >= current 0.80 - 0.02 = 0.78
    const result = evaluateCandidate("leads", { aucRoc: 0.79 }, { aucRoc: 0.80 });
    expect(result).toBe("promote");
  });

  it("promotes at exact tolerance boundary", () => {
    // candidate 0.78 >= current 0.80 - 0.02 = 0.78
    const result = evaluateCandidate("leads", { aucRoc: 0.78 }, { aucRoc: 0.80 });
    expect(result).toBe("promote");
  });

  it("rejects regression beyond 2% tolerance", () => {
    // candidate 0.70 meets absolute threshold (≥ 0.70) but
    // fails comparison: 0.70 < current 0.80 - 0.02 = 0.78 → regression
    const result = evaluateCandidate("leads", { aucRoc: 0.70 }, { aucRoc: 0.80 });
    expect(result).toBe("reject_regression");
  });

  it("rejects regression for a model that passes absolute threshold but regresses from current", () => {
    // candidate 0.72 meets absolute (0.70) but < current 0.85 - 0.02 = 0.83
    const result = evaluateCandidate("leads", { aucRoc: 0.72 }, { aucRoc: 0.85 });
    expect(result).toBe("reject_regression");
  });

  it("handles lte direction (inventory MAPE)", () => {
    // Lower MAPE is better. Candidate 0.20 <= current 0.22 + 0.02 = 0.24
    const result = evaluateCandidate("inventory", { mape: 0.20 }, { mape: 0.22 });
    expect(result).toBe("promote");
  });

  it("rejects MAPE regression beyond tolerance", () => {
    // Candidate 0.25 <= current 0.15 + 0.02 = 0.17? No → reject
    // Wait: 0.25 > 0.17, but we also need to check 0.25 <= 0.25 threshold passes
    // Then comparison: 0.25 <= 0.15 + 0.02 = 0.17? No → regression
    const result = evaluateCandidate("inventory", { mape: 0.25 }, { mape: 0.15 });
    expect(result).toBe("reject_regression");
  });

  it("promotes when current has no primary metric available", () => {
    const result = evaluateCandidate("leads", { aucRoc: 0.75 }, { accuracy: 0.90 });
    expect(result).toBe("promote");
  });

  it("promotes when candidate has no primary metric but passes threshold check via fallback", () => {
    // This actually fails because meetsDomainThreshold checks the primary metric
    const result = evaluateCandidate("leads", { accuracy: 0.90 }, { aucRoc: 0.80 });
    expect(result).toBe("reject_below_threshold"); // aucRoc is required for leads
  });
});

// ─── Consecutive failure tracking ────────────────────────────────────────────

describe("consecutive failure tracking", () => {
  beforeEach(() => {
    _consecutiveFailures.clear();
  });

  it("starts at 0 for new tenant-domain pair", () => {
    expect(getConsecutiveFailureCount("tenant-1", "leads")).toBe(0);
  });

  it("increments correctly", () => {
    expect(incrementConsecutiveFailures("tenant-1", "leads")).toBe(1);
    expect(incrementConsecutiveFailures("tenant-1", "leads")).toBe(2);
    expect(incrementConsecutiveFailures("tenant-1", "leads")).toBe(3);
  });

  it("resets to 0", () => {
    incrementConsecutiveFailures("tenant-1", "leads");
    incrementConsecutiveFailures("tenant-1", "leads");
    resetConsecutiveFailures("tenant-1", "leads");
    expect(getConsecutiveFailureCount("tenant-1", "leads")).toBe(0);
  });

  it("tracks different tenant-domain pairs independently", () => {
    incrementConsecutiveFailures("tenant-1", "leads");
    incrementConsecutiveFailures("tenant-1", "leads");
    incrementConsecutiveFailures("tenant-2", "leads");
    incrementConsecutiveFailures("tenant-1", "tickets");

    expect(getConsecutiveFailureCount("tenant-1", "leads")).toBe(2);
    expect(getConsecutiveFailureCount("tenant-2", "leads")).toBe(1);
    expect(getConsecutiveFailureCount("tenant-1", "tickets")).toBe(1);
    expect(getConsecutiveFailureCount("tenant-2", "tickets")).toBe(0);
  });
});

// ─── evaluateAndPromote ──────────────────────────────────────────────────────

describe("evaluateAndPromote", () => {
  const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const MODEL_ID = "model-candidate-1";
  const ACTOR_ID = "actor-1";

  beforeEach(() => {
    _consecutiveFailures.clear();
    vi.clearAllMocks();
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (registryPromote as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (registryDeactivate as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("promotes when candidate meets threshold and no current model exists", async () => {
    const result = await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.80 }, ACTOR_ID);

    expect(result.outcome).toBe("promoted");
    expect(result.reason).toBe("metrics_meet_threshold");
    expect(result.consecutiveFailures).toBe(0);
    expect(registryPromote).toHaveBeenCalledWith(MODEL_ID, ACTOR_ID);
  });

  it("promotes when candidate improves over current model", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "current-model",
      metrics: { aucRoc: 0.75 },
    });

    const result = await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.80 }, ACTOR_ID);

    expect(result.outcome).toBe("promoted");
    expect(registryPromote).toHaveBeenCalledWith(MODEL_ID, ACTOR_ID);
  });

  it("promotes when candidate is within 2% tolerance", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "current-model",
      metrics: { aucRoc: 0.80 },
    });

    const result = await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.79 }, ACTOR_ID);

    expect(result.outcome).toBe("promoted");
  });

  it("rejects and increments failure when below domain threshold", async () => {
    const result = await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.60 }, ACTOR_ID);

    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("below_domain_threshold");
    expect(result.consecutiveFailures).toBe(1);
    expect(registryPromote).not.toHaveBeenCalled();
  });

  it("rejects when regression exceeds tolerance", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "current-model",
      metrics: { aucRoc: 0.85 },
    });

    const result = await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.72 }, ACTOR_ID);

    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("regression_beyond_tolerance");
    expect(result.consecutiveFailures).toBe(1);
  });

  it("resets failure count on successful promotion", async () => {
    // Set up existing failures
    incrementConsecutiveFailures(TENANT, "leads");
    incrementConsecutiveFailures(TENANT, "leads");
    expect(getConsecutiveFailureCount(TENANT, "leads")).toBe(2);

    const result = await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.80 }, ACTOR_ID);

    expect(result.outcome).toBe("promoted");
    expect(result.consecutiveFailures).toBe(0);
    expect(getConsecutiveFailureCount(TENANT, "leads")).toBe(0);
  });

  it("auto-deactivates after 3 consecutive failures", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "active-model-1",
      metrics: { aucRoc: 0.85 },
    });

    // Simulate 2 prior failures
    incrementConsecutiveFailures(TENANT, "leads");
    incrementConsecutiveFailures(TENANT, "leads");

    // Third failure triggers deactivation
    const result = await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.60 }, ACTOR_ID);

    expect(result.outcome).toBe("deactivated");
    expect(result.consecutiveFailures).toBe(3);
    expect(registryDeactivate).toHaveBeenCalledWith(
      "active-model-1",
      expect.stringContaining("model_quality_degraded")
    );
  });

  it("emits ml.model.deactivated event on auto-deactivation", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "active-model-1",
      metrics: { aucRoc: 0.85 },
    });

    incrementConsecutiveFailures(TENANT, "leads");
    incrementConsecutiveFailures(TENANT, "leads");

    await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.60 }, ACTOR_ID);

    expect(enqueue).toHaveBeenCalled();
    const calls = (enqueue as ReturnType<typeof vi.fn>).mock.calls;
    const deactivationCall = calls.find(
      (c: unknown[]) => (c[1] as { topic: string }).topic === "ml.model.deactivated"
    );
    expect(deactivationCall).toBeDefined();

    const eventData = deactivationCall![1] as { payload: Record<string, unknown> };
    expect(eventData.payload.tenantId).toBe(TENANT);
    expect(eventData.payload.domain).toBe("leads");
    expect(eventData.payload.modelId).toBe("active-model-1");
    expect(eventData.payload.consecutiveFailures).toBe(3);
  });

  it("does not auto-deactivate when below threshold but no current model", async () => {
    // No current model → nothing to deactivate
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    incrementConsecutiveFailures(TENANT, "leads");
    incrementConsecutiveFailures(TENANT, "leads");

    const result = await evaluateAndPromote(MODEL_ID, TENANT, "leads", { aucRoc: 0.60 }, ACTOR_ID);

    expect(result.outcome).toBe("rejected");
    expect(result.consecutiveFailures).toBe(3);
    expect(registryDeactivate).not.toHaveBeenCalled();
  });
});

// ─── evaluateActiveModel ─────────────────────────────────────────────────────

describe("evaluateActiveModel", () => {
  const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  beforeEach(() => {
    _consecutiveFailures.clear();
    vi.clearAllMocks();
    (registryDeactivate as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("returns rejected with no_active_model when no model is active", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await evaluateActiveModel(TENANT, "leads", { aucRoc: 0.80 });

    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("no_active_model");
  });

  it("resets failure count when model passes threshold", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "active-model",
      metrics: { aucRoc: 0.80 },
    });

    incrementConsecutiveFailures(TENANT, "leads");

    const result = await evaluateActiveModel(TENANT, "leads", { aucRoc: 0.75 });

    expect(result.outcome).toBe("promoted");
    expect(result.reason).toBe("metrics_within_threshold");
    expect(result.consecutiveFailures).toBe(0);
    expect(getConsecutiveFailureCount(TENANT, "leads")).toBe(0);
  });

  it("increments failure count when model drops below threshold", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "active-model",
      metrics: { aucRoc: 0.80 },
    });

    const result = await evaluateActiveModel(TENANT, "leads", { aucRoc: 0.60 });

    expect(result.outcome).toBe("rejected");
    expect(result.consecutiveFailures).toBe(1);
  });

  it("auto-deactivates after 3 consecutive below-threshold evaluations", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "active-model",
      metrics: { aucRoc: 0.80 },
    });

    incrementConsecutiveFailures(TENANT, "leads");
    incrementConsecutiveFailures(TENANT, "leads");

    const result = await evaluateActiveModel(TENANT, "leads", { aucRoc: 0.60 });

    expect(result.outcome).toBe("deactivated");
    expect(result.consecutiveFailures).toBe(3);
    expect(registryDeactivate).toHaveBeenCalledWith(
      "active-model",
      expect.stringContaining("model_quality_degraded")
    );
  });

  it("does not deactivate at 2 consecutive failures", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "active-model",
      metrics: { aucRoc: 0.80 },
    });

    incrementConsecutiveFailures(TENANT, "leads");

    const result = await evaluateActiveModel(TENANT, "leads", { aucRoc: 0.60 });

    expect(result.outcome).toBe("rejected");
    expect(result.consecutiveFailures).toBe(2);
    expect(registryDeactivate).not.toHaveBeenCalled();
  });

  it("correctly handles tickets domain with dual metrics", async () => {
    (getCurrentModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "active-model",
      metrics: { precision: 0.70, recall: 0.85 },
    });

    // Both pass threshold
    const result = await evaluateActiveModel(TENANT, "tickets", { precision: 0.68, recall: 0.82 });
    expect(result.outcome).toBe("promoted");

    // Recall fails
    const result2 = await evaluateActiveModel(TENANT, "tickets", { precision: 0.70, recall: 0.70 });
    expect(result2.outcome).toBe("rejected");
  });
});
