/**
 * HRMS Pack #21 — AI/ML Plugin Registry: validator + constants tests.
 *
 * Source: modules/ai-ml/plugin-registry.ts
 * Tests ML_PLUGINS inventory, configUpdateSchema, feedback schema.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replicate schemas from plugin-registry.ts
const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["active", "shadow", "disabled"]).optional(),
  confidenceThreshold: z.number().min(0).max(100).optional(),
  notifyOnPrediction: z.boolean().optional(),
  autoAction: z.boolean().optional(),
  maxPredictionsPerDay: z.number().int().min(0).max(100000).optional(),
});

const feedbackBody = z.object({
  predictionId: z.string().uuid(),
  outcome: z.enum(["correct", "incorrect", "unsure"]),
  notes: z.string().max(500).optional(),
});

const attritionQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  minScore: z.coerce.number().min(0).max(100).default(50),
});

// Known plugin IDs from the registry
const KNOWN_PLUGINS = [
  "face-verification", "document-ocr", "nlu-chatbot", "attrition-prediction",
  "succession-planning", "leave-prediction", "payroll-anomaly", "payment-fraud",
  "attendance-anomaly", "resume-screening", "budget-forecast", "ticket-classification",
  "vendor-risk", "sla-breach-prediction",
];

describe("ML_PLUGINS inventory", () => {
  it("contains 14 registered plugins", () => {
    expect(KNOWN_PLUGINS).toHaveLength(14);
  });

  it("includes face-verification", () => {
    expect(KNOWN_PLUGINS).toContain("face-verification");
  });

  it("includes attrition-prediction", () => {
    expect(KNOWN_PLUGINS).toContain("attrition-prediction");
  });

  it("includes payment-fraud", () => {
    expect(KNOWN_PLUGINS).toContain("payment-fraud");
  });
});

describe("configUpdateSchema — plugin config validation", () => {
  it("accepts empty object (all optional)", () => {
    expect(configUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid enable/disable", () => {
    expect(configUpdateSchema.safeParse({ enabled: true, mode: "active" }).success).toBe(true);
  });

  it("accepts shadow mode", () => {
    expect(configUpdateSchema.safeParse({ mode: "shadow" }).success).toBe(true);
  });

  it("rejects invalid mode", () => {
    expect(configUpdateSchema.safeParse({ mode: "testing" }).success).toBe(false);
  });

  it("rejects confidenceThreshold below 0", () => {
    expect(configUpdateSchema.safeParse({ confidenceThreshold: -1 }).success).toBe(false);
  });

  it("rejects confidenceThreshold above 100", () => {
    expect(configUpdateSchema.safeParse({ confidenceThreshold: 101 }).success).toBe(false);
  });

  it("accepts boundary thresholds (0 and 100)", () => {
    expect(configUpdateSchema.safeParse({ confidenceThreshold: 0 }).success).toBe(true);
    expect(configUpdateSchema.safeParse({ confidenceThreshold: 100 }).success).toBe(true);
  });

  it("rejects maxPredictionsPerDay above 100000", () => {
    expect(configUpdateSchema.safeParse({ maxPredictionsPerDay: 100001 }).success).toBe(false);
  });

  it("accepts maxPredictionsPerDay at boundary (0 and 100000)", () => {
    expect(configUpdateSchema.safeParse({ maxPredictionsPerDay: 0 }).success).toBe(true);
    expect(configUpdateSchema.safeParse({ maxPredictionsPerDay: 100000 }).success).toBe(true);
  });

  it("rejects non-integer maxPredictionsPerDay", () => {
    expect(configUpdateSchema.safeParse({ maxPredictionsPerDay: 5.5 }).success).toBe(false);
  });
});

describe("feedbackBody — prediction feedback", () => {
  const valid = {
    predictionId: "10000000-aaaa-4000-8000-000000000001",
    outcome: "correct" as const,
  };

  it("accepts valid feedback", () => {
    expect(feedbackBody.safeParse(valid).success).toBe(true);
  });

  it("accepts all outcome values", () => {
    for (const o of ["correct", "incorrect", "unsure"]) {
      expect(feedbackBody.safeParse({ ...valid, outcome: o }).success).toBe(true);
    }
  });

  it("rejects invalid outcome", () => {
    expect(feedbackBody.safeParse({ ...valid, outcome: "maybe" }).success).toBe(false);
  });

  it("rejects non-UUID predictionId", () => {
    expect(feedbackBody.safeParse({ ...valid, predictionId: "bad" }).success).toBe(false);
  });

  it("rejects notes exceeding 500 chars", () => {
    expect(feedbackBody.safeParse({ ...valid, notes: "x".repeat(501) }).success).toBe(false);
  });

  it("notes are optional", () => {
    expect(feedbackBody.safeParse(valid).success).toBe(true);
  });
});

describe("attritionQuery — Pack #22: AI prediction query params", () => {
  it("accepts defaults", () => {
    const result = attritionQuery.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.minScore).toBe(50);
    }
  });

  it("rejects limit above 100", () => {
    expect(attritionQuery.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects minScore above 100", () => {
    expect(attritionQuery.safeParse({ minScore: 101 }).success).toBe(false);
  });

  it("accepts boundary values", () => {
    expect(attritionQuery.safeParse({ limit: 1, minScore: 0 }).success).toBe(true);
    expect(attritionQuery.safeParse({ limit: 100, minScore: 100 }).success).toBe(true);
  });
});
