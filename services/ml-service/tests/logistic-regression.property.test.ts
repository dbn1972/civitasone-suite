/**
 * Property-Based Tests for Logistic Regression Output Bounds.
 * Uses fast-check to verify invariants hold across all valid inputs.
 *
 * Property 11: Logistic Regression Output Bounds
 * `predictLogistic` must always return a value in [0.0, 1.0] regardless of
 * the weight vector, bias, or normalized feature vector supplied — the
 * sigmoid activation guarantees this bound even under extreme inputs.
 *
 * **Validates: Requirements 6.2, 15.1**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { predictLogistic } from "../src/modules/algorithms/logistic-regression.js";

// Reasonable bounds to keep generated doubles finite and representative of
// real-world trained weights/features without triggering fc's NaN/Infinity
// edge cases (which are excluded via Number.isFinite constraints below).
const finiteDouble = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

describe("logistic-regression property tests", () => {
  it("Property 11: predictLogistic always returns a value in [0.0, 1.0]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.gen(),
        (numFeatures, g) => {
          const weights = Array.from({ length: numFeatures }, () =>
            g(() => finiteDouble(-1000, 1000)),
          );
          const features = Array.from({ length: numFeatures }, () =>
            g(() => finiteDouble(-1000, 1000)),
          );
          const mean = Array.from({ length: numFeatures }, () =>
            g(() => finiteDouble(-1000, 1000)),
          );
          // std must be non-zero (division by zero would produce NaN/Infinity,
          // which is excluded by the implementation's normalization step —
          // zero-variance columns are assigned std = 1 upstream).
          const std = Array.from({ length: numFeatures }, () =>
            g(() => finiteDouble(0.001, 1000)),
          );
          const bias = g(() => finiteDouble(-1000, 1000));

          const result = predictLogistic(features, weights, bias, { mean, std });

          expect(result).toBeGreaterThanOrEqual(0.0);
          expect(result).toBeLessThanOrEqual(1.0);
          expect(Number.isFinite(result)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("Property 11: holds for empty weight/feature vectors (uninformative prior)", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (bias) => {
        const result = predictLogistic([], [], bias, { mean: [], std: [] });
        expect(result).toBeGreaterThanOrEqual(0.0);
        expect(result).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 11: holds for mismatched-length weight/feature vectors", () => {
    fc.assert(
      fc.property(
        fc.array(finiteDouble(-1000, 1000), { minLength: 1, maxLength: 10 }),
        fc.array(finiteDouble(-1000, 1000), { minLength: 1, maxLength: 10 }),
        finiteDouble(-1000, 1000),
        (weights, features, bias) => {
          const len = Math.max(weights.length, features.length);
          const mean = Array.from({ length: len }, () => 0);
          const std = Array.from({ length: len }, () => 1);

          const result = predictLogistic(features, weights, bias, { mean, std });

          expect(result).toBeGreaterThanOrEqual(0.0);
          expect(result).toBeLessThanOrEqual(1.0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
