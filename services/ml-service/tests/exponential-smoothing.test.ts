import { describe, it, expect } from "vitest";
import {
  fitExponentialSmoothing,
  forecast,
  detectSeasonality,
  type ExponentialSmoothingModel,
} from "../src/modules/algorithms/exponential-smoothing.js";

describe("exponential-smoothing", () => {
  describe("fitExponentialSmoothing", () => {
    describe("edge cases", () => {
      it("returns mean for insufficient data (< 3 points)", () => {
        const model = fitExponentialSmoothing([10, 20]);
        expect(model.type).toBe("exponential_smoothing");
        expect(model.lastLevel).toBe(15); // mean of [10, 20]
        expect(model.lastTrend).toBe(0);
        expect(model.gamma).toBeUndefined();
        expect(model.seasonalFactors).toBeUndefined();
      });

      it("returns mean for single data point", () => {
        const model = fitExponentialSmoothing([42]);
        expect(model.lastLevel).toBe(42);
        expect(model.lastTrend).toBe(0);
      });

      it("returns 0 for empty series", () => {
        const model = fitExponentialSmoothing([]);
        expect(model.lastLevel).toBe(0);
        expect(model.lastTrend).toBe(0);
      });

      it("handles flat series (zero variance) — returns constant level", () => {
        const model = fitExponentialSmoothing([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
        expect(model.lastLevel).toBe(5);
        expect(model.lastTrend).toBe(0);
        expect(model.alpha).toBe(1.0);
        expect(model.gamma).toBeUndefined();
        expect(model.seasonalFactors).toBeUndefined();
      });
    });

    describe("trending-only (no seasonal)", () => {
      it("fits an upward linear trend", () => {
        // Linear series: 10, 12, 14, 16, 18, 20, 22, 24
        const series = Array.from({ length: 8 }, (_, i) => 10 + i * 2);
        const model = fitExponentialSmoothing(series);

        expect(model.type).toBe("exponential_smoothing");
        expect(model.alpha).toBeGreaterThan(0);
        expect(model.beta).toBeGreaterThan(0);
        // Should capture upward trend
        expect(model.lastTrend).toBeGreaterThan(0);
        // No seasonal components
        expect(model.gamma).toBeUndefined();
        expect(model.seasonalFactors).toBeUndefined();
      });

      it("fits a downward linear trend", () => {
        const series = Array.from({ length: 10 }, (_, i) => 100 - i * 5);
        const model = fitExponentialSmoothing(series);
        expect(model.lastTrend).toBeLessThan(0);
      });
    });

    describe("seasonal (Holt-Winters)", () => {
      it("fits a seasonal series with known period", () => {
        // Generate 3 cycles of period 4 with some trend
        const period = 4;
        const seasonal = [10, 20, 30, 5];
        const series: number[] = [];
        for (let cycle = 0; cycle < 3; cycle++) {
          for (let i = 0; i < period; i++) {
            series.push(seasonal[i]! + cycle * 2); // slight upward trend
          }
        }

        const model = fitExponentialSmoothing(series, period);

        expect(model.type).toBe("exponential_smoothing");
        expect(model.gamma).toBeDefined();
        expect(model.gamma).toBeGreaterThan(0);
        expect(model.seasonalPeriod).toBe(period);
        expect(model.seasonalFactors).toBeDefined();
        expect(model.seasonalFactors!.length).toBe(period);
      });

      it("falls back to linear when period given but insufficient cycles", () => {
        // Only 1 cycle of period 12 — not enough for Holt-Winters (need >= 2 cycles)
        const series = Array.from({ length: 10 }, (_, i) => 50 + i * 3);
        const model = fitExponentialSmoothing(series, 12);

        // Should use Holt's linear (no seasonal)
        expect(model.gamma).toBeUndefined();
        expect(model.seasonalFactors).toBeUndefined();
        expect(model.seasonalPeriod).toBeUndefined();
      });
    });

    describe("auto-detection of seasonality", () => {
      it("auto-detects seasonal period from repeating pattern", () => {
        // Strong period-6 pattern repeated 4 times = 24 points
        const pattern = [10, 20, 30, 25, 15, 5];
        const series: number[] = [];
        for (let cycle = 0; cycle < 4; cycle++) {
          for (const v of pattern) {
            series.push(v);
          }
        }

        const model = fitExponentialSmoothing(series);

        expect(model.seasonalPeriod).toBe(6);
        expect(model.gamma).toBeDefined();
        expect(model.seasonalFactors).toHaveLength(6);
      });

      it("does not detect seasonality for trending-only data", () => {
        // Pure linear trend with small noise
        const series = Array.from({ length: 30 }, (_, i) => 100 + i * 3);
        const model = fitExponentialSmoothing(series);

        // A pure linear trend should not trigger seasonal detection
        expect(model.gamma).toBeUndefined();
        expect(model.seasonalFactors).toBeUndefined();
      });
    });
  });

  describe("forecast", () => {
    it("returns empty array for zero horizon", () => {
      const model: ExponentialSmoothingModel = {
        type: "exponential_smoothing",
        alpha: 0.3,
        beta: 0.1,
        lastLevel: 100,
        lastTrend: 2,
      };
      expect(forecast(model, 0)).toEqual([]);
    });

    it("returns empty array for negative horizon", () => {
      const model: ExponentialSmoothingModel = {
        type: "exponential_smoothing",
        alpha: 0.3,
        beta: 0.1,
        lastLevel: 100,
        lastTrend: 2,
      };
      expect(forecast(model, -5)).toEqual([]);
    });

    it("produces constant forecast for flat model (no trend)", () => {
      const model: ExponentialSmoothingModel = {
        type: "exponential_smoothing",
        alpha: 1.0,
        beta: 0,
        lastLevel: 50,
        lastTrend: 0,
      };

      const result = forecast(model, 5);
      expect(result).toHaveLength(5);
      // All values should be 50 (level + 0 trend)
      for (const v of result) {
        expect(v).toBe(50);
      }
    });

    it("produces linearly increasing forecast for trending model", () => {
      const model: ExponentialSmoothingModel = {
        type: "exponential_smoothing",
        alpha: 0.3,
        beta: 0.1,
        lastLevel: 100,
        lastTrend: 5,
      };

      const result = forecast(model, 4);
      expect(result).toHaveLength(4);
      // forecast(h) = 100 + h * 5
      expect(result[0]).toBe(105); // h=1
      expect(result[1]).toBe(110); // h=2
      expect(result[2]).toBe(115); // h=3
      expect(result[3]).toBe(120); // h=4
    });

    it("produces periodic forecast for seasonal model", () => {
      const model: ExponentialSmoothingModel = {
        type: "exponential_smoothing",
        alpha: 0.3,
        beta: 0.1,
        gamma: 0.3,
        seasonalPeriod: 4,
        lastLevel: 100,
        lastTrend: 0,
        seasonalFactors: [10, -5, 15, -10],
      };

      const result = forecast(model, 8);
      expect(result).toHaveLength(8);
      // First cycle: 100 + 1*0 + seasonal[0] = 110, etc.
      // h=1: 100 + 1*0 + 10 = 110
      expect(result[0]).toBe(110);
      // h=2: 100 + 2*0 + (-5) = 95
      expect(result[1]).toBe(95);
      // h=3: 100 + 3*0 + 15 = 115
      expect(result[2]).toBe(115);
      // h=4: 100 + 4*0 + (-10) = 90
      expect(result[3]).toBe(90);
      // Second cycle repeats same seasonal pattern
      expect(result[4]).toBe(110);
      expect(result[5]).toBe(95);
      expect(result[6]).toBe(115);
      expect(result[7]).toBe(90);
    });

    it("floors forecast values at 0 (never negative)", () => {
      const model: ExponentialSmoothingModel = {
        type: "exponential_smoothing",
        alpha: 0.3,
        beta: 0.1,
        lastLevel: 5,
        lastTrend: -10,
      };

      const result = forecast(model, 3);
      expect(result).toHaveLength(3);
      // h=1: 5 + 1*(-10) = -5 → floored to 0
      expect(result[0]).toBe(0);
      // h=2: 5 + 2*(-10) = -15 → floored to 0
      expect(result[1]).toBe(0);
      // h=3: 5 + 3*(-10) = -25 → floored to 0
      expect(result[2]).toBe(0);
    });

    it("floors seasonal forecast values at 0", () => {
      const model: ExponentialSmoothingModel = {
        type: "exponential_smoothing",
        alpha: 0.3,
        beta: 0.1,
        gamma: 0.3,
        seasonalPeriod: 3,
        lastLevel: 10,
        lastTrend: -5,
        seasonalFactors: [-20, 5, 0],
      };

      const result = forecast(model, 3);
      // h=1: 10 + 1*(-5) + (-20) = -15 → 0
      expect(result[0]).toBe(0);
      // h=2: 10 + 2*(-5) + 5 = 5
      expect(result[1]).toBe(5);
      // h=3: 10 + 3*(-5) + 0 = -5 → 0
      expect(result[2]).toBe(0);
    });
  });

  describe("detectSeasonality", () => {
    it("returns undefined for flat series", () => {
      const series = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
      expect(detectSeasonality(series)).toBeUndefined();
    });

    it("returns undefined for too-short series", () => {
      expect(detectSeasonality([1, 2, 3])).toBeUndefined();
    });

    it("detects clear period-4 pattern", () => {
      const pattern = [100, 50, 100, 50];
      const series: number[] = [];
      for (let i = 0; i < 6; i++) {
        for (const v of pattern) {
          series.push(v);
        }
      }
      // Period-2 is actually the simpler repeating unit here
      const period = detectSeasonality(series);
      expect(period).toBeDefined();
      // Should find period 2 (100,50 repeating) or period 4
      expect([2, 4]).toContain(period);
    });

    it("detects period-6 pattern in long series", () => {
      const pattern = [10, 25, 40, 35, 20, 5];
      const series: number[] = [];
      for (let i = 0; i < 5; i++) {
        for (const v of pattern) {
          series.push(v);
        }
      }
      const period = detectSeasonality(series);
      expect(period).toBe(6);
    });
  });

  describe("end-to-end: fit then forecast", () => {
    it("fit flat series → constant forecast", () => {
      const series = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7];
      const model = fitExponentialSmoothing(series);
      const result = forecast(model, 5);

      for (const v of result) {
        expect(v).toBe(7);
      }
    });

    it("fit trending series → captures slope direction", () => {
      const series = Array.from({ length: 20 }, (_, i) => 10 + i * 3);
      const model = fitExponentialSmoothing(series);
      const result = forecast(model, 5);

      // Forecast should be increasing
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!).toBeGreaterThan(result[i - 1]!);
      }
      // First forecast should be near the last observed value (67) + trend
      expect(result[0]!).toBeGreaterThan(50);
    });

    it("fit seasonal series → produces periodic forecasts", () => {
      // Strong seasonal pattern: period 4, 5 complete cycles
      const pattern = [10, 30, 50, 20];
      const series: number[] = [];
      for (let cycle = 0; cycle < 5; cycle++) {
        for (const v of pattern) {
          series.push(v);
        }
      }

      const model = fitExponentialSmoothing(series, 4);
      const result = forecast(model, 8);

      // Should produce periodic pattern across 2 forecast cycles
      // Verify the pattern repeats (same shape in positions 0-3 and 4-7)
      for (let i = 0; i < 4; i++) {
        expect(Math.abs(result[i]! - result[i + 4]!)).toBeLessThan(5);
      }
    });

    it("insufficient data → forecast returns mean values", () => {
      const series = [10, 20];
      const model = fitExponentialSmoothing(series);
      const result = forecast(model, 3);

      // Level is mean (15), trend is 0, so all forecasts should be 15
      expect(result).toHaveLength(3);
      for (const v of result) {
        expect(v).toBe(15);
      }
    });
  });
});
