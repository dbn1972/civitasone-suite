/**
 * Boundary condition tests for Revenue Recognition domain logic.
 *
 * Tests zero amount, single day, max period (366 days), bigint near MAX_SAFE.
 *
 * Validates: Requirements 23.3
 */
import { describe, it, expect } from "vitest";
import {
  dailyAccruals,
  computeDeferredBalance,
  computeTotalDays,
  isFullyRecognized,
} from "../src/modules/revenue/domain.js";

describe("Revenue Recognition — Boundary Conditions", () => {
  describe("zero amount", () => {
    it("returns array of zeros for totalPaise = 0", () => {
      const accruals = dailyAccruals(0n, 30);
      expect(accruals).toHaveLength(30);
      expect(accruals.every((a) => a === 0n)).toBe(true);
    });

    it("sum of zero accruals is exactly 0", () => {
      const accruals = dailyAccruals(0n, 365);
      const sum = accruals.reduce((s, a) => s + a, 0n);
      expect(sum).toBe(0n);
    });
  });

  describe("single day period", () => {
    it("assigns full amount to the single day", () => {
      const accruals = dailyAccruals(100000n, 1);
      expect(accruals).toHaveLength(1);
      expect(accruals[0]).toBe(100000n);
    });

    it("sum equals total for single day", () => {
      const total = 999_999n;
      const accruals = dailyAccruals(total, 1);
      expect(accruals.reduce((s, a) => s + a, 0n)).toBe(total);
    });
  });

  describe("max period (366 days — leap year)", () => {
    it("sum of 366-day accruals equals total exactly", () => {
      const total = 1_000_000n;
      const accruals = dailyAccruals(total, 366);
      expect(accruals).toHaveLength(366);
      const sum = accruals.reduce((s, a) => s + a, 0n);
      expect(sum).toBe(total);
    });

    it("handles indivisible amount over 366 days with remainder on last day", () => {
      const total = 1_000_001n; // not evenly divisible by 366
      const accruals = dailyAccruals(total, 366);
      const daily = 1_000_001n / 366n; // 2732n
      const remainder = total - daily * 366n; // 1_000_001 - 2732*366 = 1_000_001 - 999_912 = 89
      // First 365 days get 2732n each
      for (let i = 0; i < 365; i++) {
        expect(accruals[i]).toBe(daily);
      }
      // Last day gets daily + remainder
      expect(accruals[365]).toBe(daily + remainder);
      // Sum invariant holds
      expect(accruals.reduce((s, a) => s + a, 0n)).toBe(total);
    });
  });

  describe("bigint near MAX_SAFE_INTEGER", () => {
    it("handles total near 2^53 without precision loss", () => {
      const total = 9_007_199_254_740_991n; // 2^53 - 1
      const accruals = dailyAccruals(total, 30);
      const sum = accruals.reduce((s, a) => s + a, 0n);
      expect(sum).toBe(total);
    });

    it("handles total exceeding 2^53", () => {
      const total = 10_000_000_000_000_000n; // 10^16
      const accruals = dailyAccruals(total, 365);
      const sum = accruals.reduce((s, a) => s + a, 0n);
      expect(sum).toBe(total);
    });
  });

  describe("invalid inputs", () => {
    it("throws for totalDays < 1", () => {
      expect(() => dailyAccruals(1000n, 0)).toThrow("totalDays must be at least 1");
    });

    it("throws for negative totalPaise", () => {
      expect(() => dailyAccruals(-1n, 30)).toThrow("totalPaise must be non-negative");
    });
  });

  describe("computeDeferredBalance", () => {
    it("returns total when nothing is recognized", () => {
      expect(computeDeferredBalance(100000n, 0n)).toBe(100000n);
    });

    it("returns 0 when fully recognized", () => {
      expect(computeDeferredBalance(100000n, 100000n)).toBe(0n);
    });

    it("handles large bigint values", () => {
      const total = 9_007_199_254_740_991n;
      const recognized = 4_503_599_627_370_000n;
      expect(computeDeferredBalance(total, recognized)).toBe(total - recognized);
    });
  });

  describe("computeTotalDays", () => {
    it("returns 1 for same-day start and end", () => {
      expect(computeTotalDays("2024-01-01", "2024-01-01")).toBe(1);
    });

    it("computes correct days for a 1-day period", () => {
      expect(computeTotalDays("2024-01-01", "2024-01-02")).toBe(1);
    });

    it("computes correct days for a full year", () => {
      expect(computeTotalDays("2024-01-01", "2025-01-01")).toBe(366); // 2024 is leap year
    });
  });

  describe("isFullyRecognized", () => {
    it("returns true when recognized equals total", () => {
      expect(isFullyRecognized(100000n, 100000n)).toBe(true);
    });

    it("returns true when recognized exceeds total (over-recognition)", () => {
      expect(isFullyRecognized(100001n, 100000n)).toBe(true);
    });

    it("returns false when recognized is less than total", () => {
      expect(isFullyRecognized(99999n, 100000n)).toBe(false);
    });
  });
});
