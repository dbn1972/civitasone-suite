import { describe, it, expect } from "vitest";
import {
  meetsPromotionCriteria,
  validateArtifactSize,
  MAX_ARTIFACT_SIZE_BYTES,
  type ModelMetrics,
} from "../src/modules/model-registry/domain.js";

describe("meetsPromotionCriteria", () => {
  it("promotes when candidate has higher aucRoc", () => {
    const candidate: ModelMetrics = { aucRoc: 0.85 };
    const current: ModelMetrics = { aucRoc: 0.80 };
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("promotes when candidate is within 2% tolerance", () => {
    const candidate: ModelMetrics = { aucRoc: 0.79 };
    const current: ModelMetrics = { aucRoc: 0.80 };
    // 0.79 >= 0.80 - 0.02 = 0.78 → true
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("rejects when candidate is below 2% tolerance", () => {
    const candidate: ModelMetrics = { aucRoc: 0.70 };
    const current: ModelMetrics = { aucRoc: 0.80 };
    // 0.70 < 0.80 - 0.02 = 0.78 → false
    expect(meetsPromotionCriteria(candidate, current)).toBe(false);
  });

  it("promotes when candidate equals current metric exactly", () => {
    const candidate: ModelMetrics = { aucRoc: 0.80 };
    const current: ModelMetrics = { aucRoc: 0.80 };
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("promotes when exactly at tolerance boundary", () => {
    const candidate: ModelMetrics = { aucRoc: 0.78 };
    const current: ModelMetrics = { aucRoc: 0.80 };
    // 0.78 >= 0.80 - 0.02 = 0.78 → true (boundary inclusive)
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("rejects just below tolerance boundary", () => {
    const candidate: ModelMetrics = { aucRoc: 0.7799 };
    const current: ModelMetrics = { aucRoc: 0.80 };
    // 0.7799 < 0.78 → false
    expect(meetsPromotionCriteria(candidate, current)).toBe(false);
  });

  it("allows promotion when candidate has no metrics (null primary metric)", () => {
    const candidate: ModelMetrics = {};
    const current: ModelMetrics = { aucRoc: 0.80 };
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("allows promotion when current has no metrics (null primary metric)", () => {
    const candidate: ModelMetrics = { aucRoc: 0.85 };
    const current: ModelMetrics = {};
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("allows promotion when both have no metrics", () => {
    const candidate: ModelMetrics = {};
    const current: ModelMetrics = {};
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("uses accuracy as fallback metric when aucRoc is absent", () => {
    const candidate: ModelMetrics = { accuracy: 0.82 };
    const current: ModelMetrics = { accuracy: 0.80 };
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("rejects accuracy below tolerance when aucRoc is absent", () => {
    const candidate: ModelMetrics = { accuracy: 0.70 };
    const current: ModelMetrics = { accuracy: 0.80 };
    expect(meetsPromotionCriteria(candidate, current)).toBe(false);
  });

  it("uses MAPE inverted (1 - mape) for comparison", () => {
    // Lower MAPE is better. candidate: 1 - 0.20 = 0.80, current: 1 - 0.25 = 0.75
    const candidate: ModelMetrics = { mape: 0.20 };
    const current: ModelMetrics = { mape: 0.25 };
    // 0.80 >= 0.75 - 0.02 = 0.73 → true
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("rejects when MAPE is worse beyond tolerance", () => {
    // candidate: 1 - 0.40 = 0.60, current: 1 - 0.20 = 0.80
    const candidate: ModelMetrics = { mape: 0.40 };
    const current: ModelMetrics = { mape: 0.20 };
    // 0.60 < 0.80 - 0.02 = 0.78 → false
    expect(meetsPromotionCriteria(candidate, current)).toBe(false);
  });

  it("uses precision as last fallback", () => {
    const candidate: ModelMetrics = { precision: 0.75 };
    const current: ModelMetrics = { precision: 0.70 };
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });

  it("prefers aucRoc over accuracy when both present", () => {
    // aucRoc is checked first; candidate aucRoc = 0.85 vs current aucRoc = 0.80
    const candidate: ModelMetrics = { aucRoc: 0.85, accuracy: 0.50 };
    const current: ModelMetrics = { aucRoc: 0.80, accuracy: 0.90 };
    // Uses aucRoc: 0.85 >= 0.78 → true (ignores worse accuracy)
    expect(meetsPromotionCriteria(candidate, current)).toBe(true);
  });
});

describe("validateArtifactSize", () => {
  it("returns true for size within limit", () => {
    expect(validateArtifactSize(1024)).toBe(true);
    expect(validateArtifactSize(0)).toBe(true);
    expect(validateArtifactSize(10 * 1024 * 1024)).toBe(true);
  });

  it("returns true for size exactly at limit", () => {
    expect(validateArtifactSize(MAX_ARTIFACT_SIZE_BYTES)).toBe(true);
  });

  it("returns false for size exceeding limit", () => {
    expect(validateArtifactSize(MAX_ARTIFACT_SIZE_BYTES + 1)).toBe(false);
  });

  it("MAX_ARTIFACT_SIZE_BYTES equals 50MB", () => {
    expect(MAX_ARTIFACT_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("returns false for very large sizes", () => {
    expect(validateArtifactSize(100 * 1024 * 1024)).toBe(false);
    expect(validateArtifactSize(1_000_000_000)).toBe(false);
  });
});
