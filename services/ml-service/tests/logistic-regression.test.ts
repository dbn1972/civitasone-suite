import { describe, it, expect } from "vitest";
import {
  trainLogisticRegression,
  predictLogistic,
  computeFeatureImportance,
} from "../src/modules/algorithms/logistic-regression.js";

describe("logistic-regression", () => {
  describe("trainLogisticRegression", () => {
    it("returns empty weights for empty features", () => {
      const result = trainLogisticRegression([], []);
      expect(result.weights).toEqual([]);
      expect(result.bias).toBe(0);
      expect(result.normalization.mean).toEqual([]);
      expect(result.normalization.std).toEqual([]);
      expect(result.metrics.accuracy).toBe(0);
    });

    it("returns empty weights when feature vectors have zero length", () => {
      const result = trainLogisticRegression([[]], [0]);
      expect(result.weights).toEqual([]);
    });

    it("handles a single sample", () => {
      const features = [[1, 2, 3]];
      const labels = [1];
      const result = trainLogisticRegression(features, labels, {
        epochs: 100,
        learningRate: 0.1,
      });

      expect(result.weights).toHaveLength(3);
      expect(result.normalization.mean).toHaveLength(3);
      expect(result.normalization.std).toHaveLength(3);
      // Single sample with all same values => zero variance => std = 1
      expect(result.normalization.std.every((s) => s === 1)).toBe(true);
    });

    it("converges on linearly separable data", () => {
      // Simple 2D linearly separable dataset
      const features = [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
        [2, 2],
        [2, 3],
        [3, 2],
        [3, 3],
      ];
      const labels = [0, 0, 0, 0, 1, 1, 1, 1];

      const result = trainLogisticRegression(features, labels, {
        epochs: 2000,
        learningRate: 0.5,
        l2Lambda: 0.001,
      });

      expect(result.metrics.accuracy).toBeGreaterThanOrEqual(0.9);
      expect(result.metrics.aucRoc).toBeGreaterThan(0.5);
      expect(result.weights).toHaveLength(2);
    });

    it("handles zero-variance columns without NaN or Infinity", () => {
      // Third column is constant (zero variance)
      const features = [
        [1, 2, 5],
        [3, 4, 5],
        [5, 6, 5],
        [7, 8, 5],
      ];
      const labels = [0, 0, 1, 1];

      const result = trainLogisticRegression(features, labels, { epochs: 500 });

      // No NaN or Infinity in weights
      for (const w of result.weights) {
        expect(Number.isFinite(w)).toBe(true);
      }
      expect(Number.isFinite(result.bias)).toBe(true);

      // Zero-variance column gets std = 1
      expect(result.normalization.std[2]).toBe(1);
    });

    it("computes correct normalization mean and std", () => {
      const features = [
        [2, 4],
        [4, 6],
        [6, 8],
      ];
      const labels = [0, 0, 1];

      const result = trainLogisticRegression(features, labels, { epochs: 1 });

      // Mean should be [4, 6]
      expect(result.normalization.mean[0]).toBeCloseTo(4, 5);
      expect(result.normalization.mean[1]).toBeCloseTo(6, 5);

      // Std for [2,4,6]: variance = ((2-4)^2 + (4-4)^2 + (6-4)^2)/3 = 8/3, std = sqrt(8/3) ≈ 1.633
      expect(result.normalization.std[0]).toBeCloseTo(Math.sqrt(8 / 3), 5);
    });

    it("metrics are bounded between 0 and 1", () => {
      const features = [
        [1, 0],
        [0, 1],
        [1, 1],
        [0, 0],
      ];
      const labels = [1, 0, 1, 0];

      const result = trainLogisticRegression(features, labels, { epochs: 500 });

      expect(result.metrics.accuracy).toBeGreaterThanOrEqual(0);
      expect(result.metrics.accuracy).toBeLessThanOrEqual(1);
      expect(result.metrics.precision).toBeGreaterThanOrEqual(0);
      expect(result.metrics.precision).toBeLessThanOrEqual(1);
      expect(result.metrics.recall).toBeGreaterThanOrEqual(0);
      expect(result.metrics.recall).toBeLessThanOrEqual(1);
      expect(result.metrics.aucRoc).toBeGreaterThanOrEqual(0);
      expect(result.metrics.aucRoc).toBeLessThanOrEqual(1);
      expect(result.metrics.falsePositiveRate).toBeGreaterThanOrEqual(0);
      expect(result.metrics.falsePositiveRate).toBeLessThanOrEqual(1);
    });

    it("L2 regularization reduces weight magnitudes", () => {
      const features = [
        [1, 0],
        [0, 1],
        [1, 1],
        [0, 0],
        [2, 0],
        [0, 2],
      ];
      const labels = [1, 0, 1, 0, 1, 0];

      const noReg = trainLogisticRegression(features, labels, {
        epochs: 1000,
        l2Lambda: 0,
      });
      const withReg = trainLogisticRegression(features, labels, {
        epochs: 1000,
        l2Lambda: 1.0,
      });

      const noRegMag = noReg.weights.reduce((s, w) => s + w * w, 0);
      const withRegMag = withReg.weights.reduce((s, w) => s + w * w, 0);

      expect(withRegMag).toBeLessThan(noRegMag);
    });
  });

  describe("predictLogistic", () => {
    it("returns 0.5 for empty weights", () => {
      const result = predictLogistic([1, 2, 3], [], 0, { mean: [], std: [] });
      expect(result).toBe(0.5);
    });

    it("returns 0.5 for empty features", () => {
      const result = predictLogistic([], [1, 2], 0, { mean: [0, 0], std: [1, 1] });
      expect(result).toBe(0.5);
    });

    it("always returns a value in [0.0, 1.0]", () => {
      const weights = [10, -10, 5];
      const bias = 100;
      const normalization = { mean: [0, 0, 0], std: [1, 1, 1] };

      // Extreme positive input
      const highResult = predictLogistic([1000, -1000, 1000], weights, bias, normalization);
      expect(highResult).toBeGreaterThanOrEqual(0);
      expect(highResult).toBeLessThanOrEqual(1);

      // Extreme negative input
      const lowResult = predictLogistic([-1000, 1000, -1000], weights, -100, normalization);
      expect(lowResult).toBeGreaterThanOrEqual(0);
      expect(lowResult).toBeLessThanOrEqual(1);
    });

    it("produces higher probability for positive-correlated features", () => {
      // Train on simple data to get meaningful weights
      const features = [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
        [3, 3],
        [3, 4],
        [4, 3],
        [4, 4],
      ];
      const labels = [0, 0, 0, 0, 1, 1, 1, 1];

      const { weights, bias, normalization } = trainLogisticRegression(features, labels, {
        epochs: 2000,
        learningRate: 0.5,
      });

      const lowProb = predictLogistic([0, 0], weights, bias, normalization);
      const highProb = predictLogistic([4, 4], weights, bias, normalization);

      expect(highProb).toBeGreaterThan(lowProb);
      expect(highProb).toBeGreaterThan(0.5);
      expect(lowProb).toBeLessThan(0.5);
    });

    it("normalizes input features before prediction", () => {
      const weights = [1.0];
      const bias = 0;
      const normalization = { mean: [10], std: [5] };

      // Feature value 10 should normalize to 0, sigmoid(0) = 0.5
      const result = predictLogistic([10], weights, bias, normalization);
      expect(result).toBeCloseTo(0.5, 5);

      // Feature value 15 normalizes to 1, sigmoid(1) > 0.5
      const higher = predictLogistic([15], weights, bias, normalization);
      expect(higher).toBeGreaterThan(0.5);
    });
  });

  describe("computeFeatureImportance", () => {
    it("returns empty array for empty inputs", () => {
      expect(computeFeatureImportance([], [], [])).toEqual([]);
      expect(computeFeatureImportance([1], [], ["a"])).toEqual([]);
      expect(computeFeatureImportance([1], [1], [])).toEqual([]);
    });

    it("returns top 3 factors by default", () => {
      const features = [1, 2, 3, 4, 5];
      const weights = [0.5, -0.3, 0.8, -0.1, 0.2];
      const names = ["a", "b", "c", "d", "e"];

      const result = computeFeatureImportance(features, weights, names);
      expect(result).toHaveLength(3);
    });

    it("respects topN parameter", () => {
      const features = [1, 2, 3, 4, 5];
      const weights = [0.5, -0.3, 0.8, -0.1, 0.2];
      const names = ["a", "b", "c", "d", "e"];

      const result = computeFeatureImportance(features, weights, names, 2);
      expect(result).toHaveLength(2);
    });

    it("ranks features by absolute contribution", () => {
      const features = [1, 1, 1];
      const weights = [0.1, -0.5, 0.3];
      const names = ["small", "large_neg", "medium"];

      const result = computeFeatureImportance(features, weights, names, 3);

      // |0.1| < |0.3| < |0.5|, so order: large_neg, medium, small
      expect(result[0]!.feature).toBe("large_neg");
      expect(result[1]!.feature).toBe("medium");
      expect(result[2]!.feature).toBe("small");
    });

    it("assigns correct direction based on weight * feature sign", () => {
      const features = [2, -3];
      const weights = [1, 1];
      const names = ["positive", "negative"];

      const result = computeFeatureImportance(features, weights, names, 2);

      const pos = result.find((f) => f.feature === "positive");
      const neg = result.find((f) => f.feature === "negative");

      expect(pos!.direction).toBe("positive");
      expect(neg!.direction).toBe("negative");
    });

    it("contributions sum to approximately 1.0 when all features included", () => {
      const features = [1, 2, 3];
      const weights = [0.5, -0.3, 0.8];
      const names = ["a", "b", "c"];

      const result = computeFeatureImportance(features, weights, names, 3);
      const totalContribution = result.reduce((s, f) => s + f.contribution, 0);

      expect(totalContribution).toBeCloseTo(1.0, 5);
    });

    it("handles zero weights gracefully", () => {
      const features = [1, 2, 3];
      const weights = [0, 0, 0];
      const names = ["a", "b", "c"];

      const result = computeFeatureImportance(features, weights, names);

      // All contributions should be 0 (totalAbs = 0)
      for (const factor of result) {
        expect(factor.contribution).toBe(0);
      }
    });

    it("handles mismatched array lengths by using minimum", () => {
      const features = [1, 2];
      const weights = [0.5, -0.3, 0.8]; // longer than features
      const names = ["a", "b", "c"];

      const result = computeFeatureImportance(features, weights, names);
      // Should only use first 2 (min of features.length, weights.length, names.length)
      expect(result.length).toBeLessThanOrEqual(2);
    });
  });
});
