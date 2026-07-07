/**
 * Cycle Count domain logic tests.
 *
 * Covers:
 *   1. Auto-adjust threshold computation (5% of system qty or 10 units, whichever greater)
 *   2. Variance within threshold → auto_posted status
 *   3. Variance above threshold → pending_approval status
 *   4. Edge cases: zero system qty, exact threshold boundary, large quantities
 *   5. Input validation: negative physical qty, missing reason code
 *
 * Validates: Requirements 14.7, 14.8, 14.9
 */
import { describe, it, expect } from "vitest";
import {
  evaluateCycleCount,
  computeAutoAdjustThreshold,
  validateReasonCode,
  type CycleCountInput,
} from "../src/modules/cycle-count/domain.js";

describe("computeAutoAdjustThreshold", () => {
  it("returns 10 units when 5% of system qty is less than 10", () => {
    // 5% of 100 = 5, which is less than 10 → threshold = 10
    expect(computeAutoAdjustThreshold(100)).toBe(10);
  });

  it("returns 5% of system qty when it exceeds 10 units", () => {
    // 5% of 500 = 25, which is greater than 10 → threshold = 25
    expect(computeAutoAdjustThreshold(500)).toBe(25);
  });

  it("returns 10 at the exact breakpoint (200 units: 5% = 10)", () => {
    // 5% of 200 = 10, equals the unit threshold → max(10, 10) = 10
    expect(computeAutoAdjustThreshold(200)).toBe(10);
  });

  it("handles zero system qty (threshold = 10 units)", () => {
    // 5% of 0 = 0, less than 10 → threshold = 10
    expect(computeAutoAdjustThreshold(0)).toBe(10);
  });

  it("handles very large system qty", () => {
    // 5% of 1,000,000 = 50,000
    expect(computeAutoAdjustThreshold(1_000_000)).toBe(50_000);
  });

  it("uses custom percentage threshold", () => {
    // 10% of 100 = 10, max(10, 10) = 10
    expect(computeAutoAdjustThreshold(100, 10, 10)).toBe(10);
    // 10% of 200 = 20, max(20, 10) = 20
    expect(computeAutoAdjustThreshold(200, 10, 10)).toBe(20);
  });

  it("uses custom unit threshold", () => {
    // 5% of 100 = 5, max(5, 20) = 20
    expect(computeAutoAdjustThreshold(100, 5, 20)).toBe(20);
  });

  it("handles negative system qty (uses absolute value)", () => {
    // 5% of |-100| = 5, max(5, 10) = 10
    expect(computeAutoAdjustThreshold(-100)).toBe(10);
  });
});

describe("evaluateCycleCount — auto-adjust within threshold", () => {
  it("auto-posts when variance equals zero", () => {
    const result = evaluateCycleCount({
      systemQty: 100,
      physicalQty: 100,
      reasonCode: "cycle_count",
    });
    expect(result.variance).toBe(0);
    expect(result.absVariance).toBe(0);
    expect(result.withinThreshold).toBe(true);
    expect(result.status).toBe("auto_posted");
  });

  it("auto-posts when variance is within threshold (surplus)", () => {
    // System: 100, Physical: 108 → variance: 8, threshold: 10 → within
    const result = evaluateCycleCount({
      systemQty: 100,
      physicalQty: 108,
      reasonCode: "recount",
    });
    expect(result.variance).toBe(8);
    expect(result.absVariance).toBe(8);
    expect(result.autoAdjustThreshold).toBe(10);
    expect(result.withinThreshold).toBe(true);
    expect(result.status).toBe("auto_posted");
  });

  it("auto-posts when variance is within threshold (shortage)", () => {
    // System: 100, Physical: 93 → variance: -7, threshold: 10 → within
    const result = evaluateCycleCount({
      systemQty: 100,
      physicalQty: 93,
      reasonCode: "shrinkage",
    });
    expect(result.variance).toBe(-7);
    expect(result.absVariance).toBe(7);
    expect(result.withinThreshold).toBe(true);
    expect(result.status).toBe("auto_posted");
  });

  it("auto-posts at exact threshold boundary", () => {
    // System: 100, threshold: 10, variance exactly 10 → within (≤)
    const result = evaluateCycleCount({
      systemQty: 100,
      physicalQty: 110,
      reasonCode: "cycle_count",
    });
    expect(result.absVariance).toBe(10);
    expect(result.autoAdjustThreshold).toBe(10);
    expect(result.withinThreshold).toBe(true);
    expect(result.status).toBe("auto_posted");
  });

  it("auto-posts for large qty where 5% threshold applies", () => {
    // System: 1000, 5% = 50 units threshold
    // Physical: 1040 → variance: 40, within 50 → auto-post
    const result = evaluateCycleCount({
      systemQty: 1000,
      physicalQty: 1040,
      reasonCode: "recount",
    });
    expect(result.autoAdjustThreshold).toBe(50);
    expect(result.absVariance).toBe(40);
    expect(result.withinThreshold).toBe(true);
    expect(result.status).toBe("auto_posted");
  });
});

describe("evaluateCycleCount — approval required above threshold", () => {
  it("requires approval when variance exceeds threshold", () => {
    // System: 100, Physical: 115 → variance: 15, threshold: 10 → exceeds
    const result = evaluateCycleCount({
      systemQty: 100,
      physicalQty: 115,
      reasonCode: "cycle_count",
    });
    expect(result.variance).toBe(15);
    expect(result.absVariance).toBe(15);
    expect(result.autoAdjustThreshold).toBe(10);
    expect(result.withinThreshold).toBe(false);
    expect(result.status).toBe("pending_approval");
  });

  it("requires approval for shortage exceeding threshold", () => {
    // System: 500, 5% = 25 threshold
    // Physical: 470 → variance: -30, abs: 30, exceeds 25
    const result = evaluateCycleCount({
      systemQty: 500,
      physicalQty: 470,
      reasonCode: "theft",
    });
    expect(result.absVariance).toBe(30);
    expect(result.autoAdjustThreshold).toBe(25);
    expect(result.withinThreshold).toBe(false);
    expect(result.status).toBe("pending_approval");
  });

  it("requires approval just above threshold boundary", () => {
    // System: 100, threshold: 10, variance: 11 → exceeds
    const result = evaluateCycleCount({
      systemQty: 100,
      physicalQty: 111,
      reasonCode: "cycle_count",
    });
    expect(result.absVariance).toBe(11);
    expect(result.withinThreshold).toBe(false);
    expect(result.status).toBe("pending_approval");
  });

  it("uses custom threshold when provided", () => {
    // Custom: 2% or 5 units (whichever greater)
    // System: 100, 2% = 2, max(2, 5) = 5
    // Physical: 107 → variance: 7, exceeds 5
    const result = evaluateCycleCount({
      systemQty: 100,
      physicalQty: 107,
      reasonCode: "cycle_count",
      thresholdPct: 2,
      thresholdUnits: 5,
    });
    expect(result.autoAdjustThreshold).toBe(5);
    expect(result.absVariance).toBe(7);
    expect(result.withinThreshold).toBe(false);
    expect(result.status).toBe("pending_approval");
  });
});

describe("evaluateCycleCount — edge cases", () => {
  it("handles zero system qty (physical is the variance)", () => {
    // System: 0, Physical: 5 → variance: 5, threshold: 10 (unit-based) → within
    const result = evaluateCycleCount({
      systemQty: 0,
      physicalQty: 5,
      reasonCode: "found_stock",
    });
    expect(result.variance).toBe(5);
    expect(result.autoAdjustThreshold).toBe(10);
    expect(result.withinThreshold).toBe(true);
    expect(result.status).toBe("auto_posted");
  });

  it("requires approval for large variance from zero system qty", () => {
    // System: 0, Physical: 15 → variance: 15, threshold: 10 → exceeds
    const result = evaluateCycleCount({
      systemQty: 0,
      physicalQty: 15,
      reasonCode: "found_stock",
    });
    expect(result.absVariance).toBe(15);
    expect(result.withinThreshold).toBe(false);
    expect(result.status).toBe("pending_approval");
  });

  it("handles physical qty of zero (total shortage)", () => {
    // System: 100, Physical: 0 → variance: -100, threshold: 10 → exceeds
    const result = evaluateCycleCount({
      systemQty: 100,
      physicalQty: 0,
      reasonCode: "total_loss",
    });
    expect(result.variance).toBe(-100);
    expect(result.absVariance).toBe(100);
    expect(result.withinThreshold).toBe(false);
    expect(result.status).toBe("pending_approval");
  });
});

describe("evaluateCycleCount — input validation", () => {
  it("rejects negative physical quantity", () => {
    expect(() =>
      evaluateCycleCount({
        systemQty: 100,
        physicalQty: -5,
        reasonCode: "cycle_count",
      }),
    ).toThrowError("INVALID_PHYSICAL_QTY");
  });

  it("rejects empty reason code", () => {
    expect(() =>
      evaluateCycleCount({
        systemQty: 100,
        physicalQty: 95,
        reasonCode: "",
      }),
    ).toThrowError("REASON_CODE_REQUIRED");
  });

  it("rejects whitespace-only reason code", () => {
    expect(() =>
      evaluateCycleCount({
        systemQty: 100,
        physicalQty: 95,
        reasonCode: "   ",
      }),
    ).toThrowError("REASON_CODE_REQUIRED");
  });
});

describe("validateReasonCode", () => {
  const allowedCodes = ["cycle_count", "recount", "shrinkage", "found_stock", "damage"];

  it("accepts valid reason code", () => {
    expect(() => validateReasonCode("cycle_count", allowedCodes)).not.toThrow();
  });

  it("rejects invalid reason code", () => {
    expect(() => validateReasonCode("invalid_code", allowedCodes)).toThrowError("INVALID_REASON_CODE");
  });
});
