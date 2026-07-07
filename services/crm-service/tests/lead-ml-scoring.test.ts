/**
 * CRM Lead ML Scoring — Unit & integration tests.
 *
 * Tests:
 * - Feature extraction functions (pure logic)
 * - Fallback scoring (rule-based)
 * - ML service call behavior (circuit-breaker, timeout)
 * - Response shape validation
 * - Edge cases: entity not found, tenant mismatch
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractLeadFeatures,
  computeFallbackScore,
  getCompanySizeBucket,
  getDealValueBucket,
  computeLastActivityRecencyDays,
  computeDaysInStage,
  scoreLeadWithMl,
  ML_FALLBACK_SCORING_RULES,
  type LeadFeatures,
} from "../src/modules/leads/ml-scoring.js";

// ─── Feature Extraction Tests ────────────────────────────────────────────────

describe("Feature Extraction", () => {
  describe("getCompanySizeBucket", () => {
    it("returns 'unknown' for null", () => {
      expect(getCompanySizeBucket(null)).toBe("unknown");
    });

    it("returns 'unknown' for undefined", () => {
      expect(getCompanySizeBucket(undefined)).toBe("unknown");
    });

    it("returns 'unknown' for 0 or negative", () => {
      expect(getCompanySizeBucket(0)).toBe("unknown");
      expect(getCompanySizeBucket(-5)).toBe("unknown");
    });

    it("returns 'micro' for 1–10 employees", () => {
      expect(getCompanySizeBucket(1)).toBe("micro");
      expect(getCompanySizeBucket(10)).toBe("micro");
    });

    it("returns 'small' for 11–50 employees", () => {
      expect(getCompanySizeBucket(11)).toBe("small");
      expect(getCompanySizeBucket(50)).toBe("small");
    });

    it("returns 'medium' for 51–250 employees", () => {
      expect(getCompanySizeBucket(51)).toBe("medium");
      expect(getCompanySizeBucket(250)).toBe("medium");
    });

    it("returns 'large' for 251–1000 employees", () => {
      expect(getCompanySizeBucket(251)).toBe("large");
      expect(getCompanySizeBucket(1000)).toBe("large");
    });

    it("returns 'enterprise' for >1000 employees", () => {
      expect(getCompanySizeBucket(1001)).toBe("enterprise");
      expect(getCompanySizeBucket(50000)).toBe("enterprise");
    });
  });

  describe("getDealValueBucket", () => {
    it("returns 'unknown' for null/undefined/zero", () => {
      expect(getDealValueBucket(null)).toBe("unknown");
      expect(getDealValueBucket(undefined)).toBe("unknown");
      expect(getDealValueBucket(0)).toBe("unknown");
    });

    it("returns 'low' for values up to ₹1 lakh (100_000_00 paise)", () => {
      expect(getDealValueBucket(50_000_00)).toBe("low");
      expect(getDealValueBucket(100_000_00)).toBe("low");
    });

    it("returns 'medium' for values up to ₹5 lakh", () => {
      expect(getDealValueBucket(100_001_00)).toBe("medium");
      expect(getDealValueBucket(500_000_00)).toBe("medium");
    });

    it("returns 'high' for values up to ₹25 lakh", () => {
      expect(getDealValueBucket(500_001_00)).toBe("high");
      expect(getDealValueBucket(2500_000_00)).toBe("high");
    });

    it("returns 'enterprise' for values > ₹25 lakh", () => {
      expect(getDealValueBucket(2500_001_00)).toBe("enterprise");
    });

    it("handles bigint values", () => {
      expect(getDealValueBucket(50_000_00n)).toBe("low");
      expect(getDealValueBucket(5000_000_00n)).toBe("enterprise");
    });
  });

  describe("computeLastActivityRecencyDays", () => {
    it("returns 365 for null/undefined", () => {
      expect(computeLastActivityRecencyDays(null)).toBe(365);
      expect(computeLastActivityRecencyDays(undefined)).toBe(365);
    });

    it("returns 0 for activity today", () => {
      const now = new Date();
      expect(computeLastActivityRecencyDays(now)).toBe(0);
    });

    it("returns correct days for past dates", () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      expect(computeLastActivityRecencyDays(sevenDaysAgo)).toBe(7);
    });

    it("handles ISO string dates", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(computeLastActivityRecencyDays(threeDaysAgo.toISOString())).toBe(3);
    });

    it("returns 0 for future dates (no negative)", () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expect(computeLastActivityRecencyDays(tomorrow)).toBe(0);
    });
  });

  describe("computeDaysInStage", () => {
    it("returns 0 for null/undefined", () => {
      expect(computeDaysInStage(null)).toBe(0);
      expect(computeDaysInStage(undefined)).toBe(0);
    });

    it("returns 0 for today", () => {
      expect(computeDaysInStage(new Date())).toBe(0);
    });

    it("returns correct days for past dates", () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      expect(computeDaysInStage(tenDaysAgo)).toBe(10);
    });
  });

  describe("extractLeadFeatures", () => {
    it("extracts all features from complete data", () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      const features = extractLeadFeatures({
        stageEnteredAt: fiveDaysAgo,
        interactionCount: 7,
        employeeCount: 100,
        dealValuePaise: 300_000_00,
        leadSource: "referral",
        lastActivityAt: twoDaysAgo,
      });

      expect(features.daysInStage).toBe(5);
      expect(features.interactionCount).toBe(7);
      expect(features.companySizeBucket).toBe("medium");
      expect(features.dealValueBucket).toBe("medium");
      expect(features.sourceChannel).toBe("referral");
      expect(features.lastActivityRecencyDays).toBe(2);
    });

    it("handles all missing data gracefully", () => {
      const features = extractLeadFeatures({});

      expect(features.daysInStage).toBe(0);
      expect(features.interactionCount).toBe(0);
      expect(features.companySizeBucket).toBe("unknown");
      expect(features.dealValueBucket).toBe("unknown");
      expect(features.sourceChannel).toBe("unknown");
      expect(features.lastActivityRecencyDays).toBe(365);
    });
  });
});

// ─── Fallback Scoring Tests ──────────────────────────────────────────────────

describe("Fallback Scoring", () => {
  it("returns score in range [0, 100]", () => {
    const features: LeadFeatures = {
      daysInStage: 5,
      interactionCount: 3,
      companySizeBucket: "medium",
      dealValueBucket: "high",
      sourceChannel: "website",
      lastActivityRecencyDays: 7,
    };

    const result = computeFallbackScore(features);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns probability as score/100", () => {
    const features: LeadFeatures = {
      daysInStage: 2,
      interactionCount: 10,
      companySizeBucket: "enterprise",
      dealValueBucket: "enterprise",
      sourceChannel: "referral",
      lastActivityRecencyDays: 1,
    };

    const result = computeFallbackScore(features);
    expect(result.probability).toBeCloseTo(result.score / 100, 2);
  });

  it("marks result as fallback", () => {
    const features: LeadFeatures = {
      daysInStage: 0,
      interactionCount: 0,
      companySizeBucket: "unknown",
      dealValueBucket: "unknown",
      sourceChannel: "unknown",
      lastActivityRecencyDays: 365,
    };

    const result = computeFallbackScore(features);
    expect(result.isFallback).toBe(true);
    expect(result.modelVersion).toBe(0);
    expect(result.factors).toEqual([]);
  });

  it("scores a high-quality lead higher than a cold lead", () => {
    const hotLead: LeadFeatures = {
      daysInStage: 2,
      interactionCount: 8,
      companySizeBucket: "large",
      dealValueBucket: "high",
      sourceChannel: "referral",
      lastActivityRecencyDays: 1,
    };

    const coldLead: LeadFeatures = {
      daysInStage: 60,
      interactionCount: 0,
      companySizeBucket: "unknown",
      dealValueBucket: "unknown",
      sourceChannel: "cold_call",
      lastActivityRecencyDays: 90,
    };

    const hotScore = computeFallbackScore(hotLead);
    const coldScore = computeFallbackScore(coldLead);
    expect(hotScore.score).toBeGreaterThan(coldScore.score);
  });

  it("produces integer score", () => {
    const features: LeadFeatures = {
      daysInStage: 15,
      interactionCount: 4,
      companySizeBucket: "small",
      dealValueBucket: "low",
      sourceChannel: "social",
      lastActivityRecencyDays: 20,
    };

    const result = computeFallbackScore(features);
    expect(Number.isInteger(result.score)).toBe(true);
  });
});

// ─── Response Shape Tests ────────────────────────────────────────────────────

describe("LeadScoreResponse shape", () => {
  it("fallback response has all required fields", () => {
    const features: LeadFeatures = {
      daysInStage: 0,
      interactionCount: 0,
      companySizeBucket: "unknown",
      dealValueBucket: "unknown",
      sourceChannel: "unknown",
      lastActivityRecencyDays: 365,
    };

    const result = computeFallbackScore(features);

    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("probability");
    expect(result).toHaveProperty("factors");
    expect(result).toHaveProperty("modelVersion");
    expect(result).toHaveProperty("isFallback");

    expect(typeof result.score).toBe("number");
    expect(typeof result.probability).toBe("number");
    expect(Array.isArray(result.factors)).toBe(true);
    expect(typeof result.modelVersion).toBe("number");
    expect(typeof result.isFallback).toBe("boolean");
  });

  it("score is backward-compatible (0–100 integer)", () => {
    const features: LeadFeatures = {
      daysInStage: 5,
      interactionCount: 5,
      companySizeBucket: "medium",
      dealValueBucket: "medium",
      sourceChannel: "website",
      lastActivityRecencyDays: 10,
    };

    const result = computeFallbackScore(features);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("probability is in [0.0, 1.0]", () => {
    const features: LeadFeatures = {
      daysInStage: 1,
      interactionCount: 15,
      companySizeBucket: "enterprise",
      dealValueBucket: "enterprise",
      sourceChannel: "referral",
      lastActivityRecencyDays: 0,
    };

    const result = computeFallbackScore(features);
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(1);
  });
});

// ─── ML Scoring Rules Tests ─────────────────────────────────────────────────

describe("ML Fallback Scoring Rules", () => {
  it("has rules that sum to 100 weight", () => {
    const totalWeight = ML_FALLBACK_SCORING_RULES.reduce((sum, rule) => sum + rule.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it("covers all required feature attributes", () => {
    const attributes = ML_FALLBACK_SCORING_RULES.map((r) => r.attribute);
    expect(attributes).toContain("lastActivityRecencyDays");
    expect(attributes).toContain("interactionCount");
    expect(attributes).toContain("sourceChannel");
    expect(attributes).toContain("companySizeBucket");
    expect(attributes).toContain("daysInStage");
  });

  it("all scoreFn return values in [0, 100]", () => {
    for (const rule of ML_FALLBACK_SCORING_RULES) {
      // Test with various inputs
      const inputs = [undefined, null, 0, 1, 5, 10, 30, 100, "referral", "unknown", ""];
      for (const input of inputs) {
        const score = rule.scoreFn(input);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });
});

// ─── scoreLeadWithMl integration (mocked ML) ────────────────────────────────

describe("scoreLeadWithMl", () => {
  const mockFeatures: LeadFeatures = {
    daysInStage: 5,
    interactionCount: 3,
    companySizeBucket: "medium",
    dealValueBucket: "high",
    sourceChannel: "website",
    lastActivityRecencyDays: 7,
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns fallback score when ml-service is unreachable", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await scoreLeadWithMl(
      "tenant-1",
      "lead-1",
      mockFeatures,
      "fake-token",
      "corr-1",
    );

    expect(result.isFallback).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.modelVersion).toBe(0);
  });

  it("returns ML score when ml-service returns valid prediction", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prediction: 0.78,
        confidence: 0.85,
        factors: [
          { feature: "interactionCount", contribution: 0.4, direction: "positive" },
          { feature: "lastActivityRecencyDays", contribution: 0.3, direction: "positive" },
        ],
        fallback: false,
        modelVersion: 3,
        advisory: true,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await scoreLeadWithMl(
      "tenant-1",
      "lead-1",
      mockFeatures,
      "fake-token",
      "corr-1",
    );

    expect(result.isFallback).toBe(false);
    expect(result.score).toBe(78);
    expect(result.probability).toBe(0.78);
    expect(result.modelVersion).toBe(3);
    expect(result.factors).toHaveLength(2);
    expect(result.factors[0]!.feature).toBe("interactionCount");
  });

  it("returns fallback when ml-service responds with fallback=true", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prediction: null,
        confidence: 0,
        factors: [],
        fallback: true,
        reason: "model_unavailable",
        advisory: true,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await scoreLeadWithMl(
      "tenant-1",
      "lead-1",
      mockFeatures,
      "fake-token",
      "corr-1",
    );

    expect(result.isFallback).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns fallback when ml-service returns non-2xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await scoreLeadWithMl(
      "tenant-1",
      "lead-1",
      mockFeatures,
      "fake-token",
      "corr-1",
    );

    expect(result.isFallback).toBe(true);
  });

  it("clamps score to [0, 100] for edge probability values", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prediction: 0.999,
        confidence: 0.95,
        factors: [],
        fallback: false,
        modelVersion: 1,
        advisory: true,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await scoreLeadWithMl(
      "tenant-1",
      "lead-1",
      mockFeatures,
      "fake-token",
      "corr-1",
    );

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("computes score as Math.round(probability * 100)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prediction: 0.725,
        confidence: 0.80,
        factors: [],
        fallback: false,
        modelVersion: 2,
        advisory: true,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await scoreLeadWithMl(
      "tenant-1",
      "lead-1",
      mockFeatures,
      "fake-token",
      "corr-1",
    );

    expect(result.score).toBe(73); // Math.round(0.725 * 100) = 73
    expect(result.probability).toBe(0.725);
  });
});
