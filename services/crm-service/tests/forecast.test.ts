/**
 * Forecast domain logic tests.
 *
 * Tests the pure `weightedForecast` and `weightedForecastByStage` functions.
 * - Basic computation with various deals/probabilities
 * - Bigint precision (large values, no precision loss)
 * - Edge cases: empty deals, 0% probability, 100% probability
 * - Multiple stages
 *
 * Validates: Requirements 8.4
 */
import { describe, it, expect } from "vitest";
import {
  weightedForecast,
  weightedForecastByStage,
  type DealForForecast,
} from "../src/modules/deals/forecast.js";

describe("weightedForecast", () => {
  describe("basic computation", () => {
    it("computes weighted value for a single deal", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 100_00n }, // Rs 100 in paise
      ];
      const probs = new Map([["s1", 50]]); // 50%
      // 10000n * 50n / 100n = 5000n (Rs 50)
      expect(weightedForecast(deals, probs)).toBe(5000n);
    });

    it("sums weighted values across multiple deals", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 10000n },
        { id: "d2", stageId: "s2", valueMinor: 20000n },
      ];
      const probs = new Map([["s1", 50], ["s2", 75]]);
      // (10000 * 50 / 100) + (20000 * 75 / 100) = 5000 + 15000 = 20000
      expect(weightedForecast(deals, probs)).toBe(20000n);
    });

    it("handles deals in the same stage", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 10000n },
        { id: "d2", stageId: "s1", valueMinor: 30000n },
      ];
      const probs = new Map([["s1", 25]]);
      // (10000 * 25 / 100) + (30000 * 25 / 100) = 2500 + 7500 = 10000
      expect(weightedForecast(deals, probs)).toBe(10000n);
    });
  });

  describe("bigint precision", () => {
    it("handles large values without precision loss", () => {
      // Rs 50 crore = 50_00_00_000 rupees = 50_00_00_000_00 paise
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 50_00_00_000_00n },
      ];
      const probs = new Map([["s1", 80]]);
      // 5000000000 * 80 / 100 = 4000000000 (Rs 40 crore in paise)
      expect(weightedForecast(deals, probs)).toBe(40_00_00_000_00n);
    });

    it("uses floor division (truncation)", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 333n }, // 3.33 rupees
      ];
      const probs = new Map([["s1", 33]]);
      // 333n * 33n / 100n = 10989n / 100n = 109n (floor division)
      expect(weightedForecast(deals, probs)).toBe(109n);
    });

    it("handles values exceeding Number.MAX_SAFE_INTEGER", () => {
      // Bigger than 2^53
      const bigValue = BigInt("100000000000000000"); // 10^17
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: bigValue },
      ];
      const probs = new Map([["s1", 75]]);
      // 10^17 * 75 / 100 = 75 * 10^15 = 75000000000000000n
      expect(weightedForecast(deals, probs)).toBe(75000000000000000n);
    });

    it("no floating point rounding errors with typical deal values", () => {
      // Rs 1,23,456.78 = 12345678 paise at 33% probability
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 12345678n },
      ];
      const probs = new Map([["s1", 33]]);
      // 12345678n * 33n / 100n = 407,407,374n / 100n = 4074073n (floor)
      expect(weightedForecast(deals, probs)).toBe(4074073n);
    });
  });

  describe("edge cases", () => {
    it("returns 0n for empty deals array", () => {
      expect(weightedForecast([], new Map())).toBe(0n);
    });

    it("returns 0n when all probabilities are 0%", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 1000000n },
      ];
      const probs = new Map([["s1", 0]]);
      expect(weightedForecast(deals, probs)).toBe(0n);
    });

    it("returns full value when probability is 100%", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 5000n },
      ];
      const probs = new Map([["s1", 100]]);
      expect(weightedForecast(deals, probs)).toBe(5000n);
    });

    it("treats missing stageId in probability map as 0%", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "unknown-stage", valueMinor: 50000n },
      ];
      const probs = new Map([["s1", 80]]);
      expect(weightedForecast(deals, probs)).toBe(0n);
    });

    it("handles zero-value deal correctly", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 0n },
      ];
      const probs = new Map([["s1", 50]]);
      expect(weightedForecast(deals, probs)).toBe(0n);
    });

    it("clamps probability above 100 to 100", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 1000n },
      ];
      const probs = new Map([["s1", 150]]);
      // Should clamp to 100: 1000 * 100 / 100 = 1000
      expect(weightedForecast(deals, probs)).toBe(1000n);
    });

    it("clamps negative probability to 0", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 1000n },
      ];
      const probs = new Map([["s1", -10]]);
      expect(weightedForecast(deals, probs)).toBe(0n);
    });
  });

  describe("multiple stages and deals", () => {
    it("correctly forecasts a realistic pipeline", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "prospecting", valueMinor: 500000_00n }, // Rs 5 lakh
        { id: "d2", stageId: "negotiation", valueMinor: 300000_00n }, // Rs 3 lakh
        { id: "d3", stageId: "proposal", valueMinor: 200000_00n },   // Rs 2 lakh
        { id: "d4", stageId: "negotiation", valueMinor: 100000_00n }, // Rs 1 lakh
      ];
      const probs = new Map([
        ["prospecting", 20],
        ["proposal", 50],
        ["negotiation", 75],
      ]);
      // d1: 50000000 * 20 / 100 = 10000000
      // d2: 30000000 * 75 / 100 = 22500000
      // d3: 20000000 * 50 / 100 = 10000000
      // d4: 10000000 * 75 / 100 = 7500000
      // Total: 50000000n
      expect(weightedForecast(deals, probs)).toBe(50000000n);
    });
  });
});

describe("weightedForecastByStage", () => {
  it("groups weighted totals by stage", () => {
    const deals: DealForForecast[] = [
      { id: "d1", stageId: "s1", valueMinor: 10000n },
      { id: "d2", stageId: "s2", valueMinor: 20000n },
      { id: "d3", stageId: "s1", valueMinor: 30000n },
    ];
    const probs = new Map([["s1", 50], ["s2", 75]]);
    const result = weightedForecastByStage(deals, probs);
    // s1: (10000 * 50 / 100) + (30000 * 50 / 100) = 5000 + 15000 = 20000
    expect(result.get("s1")).toBe(20000n);
    // s2: (20000 * 75 / 100) = 15000
    expect(result.get("s2")).toBe(15000n);
  });

  it("returns empty map for empty deals", () => {
    const result = weightedForecastByStage([], new Map());
    expect(result.size).toBe(0);
  });
});
