import { describe, it, expect } from "vitest";
import {
  dailyAccruals,
  computeDeferredBalance,
  computeTotalDays,
  isFullyRecognized,
} from "../src/modules/revenue/domain.js";

describe("revenue domain — dailyAccruals", () => {
  it("distributes evenly for exact division", () => {
    // 3000 paise over 3 days = 1000 per day
    const accruals = dailyAccruals(3000n, 3);
    expect(accruals).toHaveLength(3);
    expect(accruals[0]).toBe(1000n);
    expect(accruals[1]).toBe(1000n);
    expect(accruals[2]).toBe(1000n);
  });

  it("applies remainder to last day for non-exact division", () => {
    // 10000 paise over 3 days: 3333 + 3333 + 3334
    const accruals = dailyAccruals(10000n, 3);
    expect(accruals).toHaveLength(3);
    expect(accruals[0]).toBe(3333n);
    expect(accruals[1]).toBe(3333n);
    expect(accruals[2]).toBe(3334n);
  });

  it("sum of all accruals equals total (invariant)", () => {
    const total = 999999n;
    const days = 31;
    const accruals = dailyAccruals(total, days);
    const sum = accruals.reduce((a, b) => a + b, 0n);
    expect(sum).toBe(total);
  });

  it("handles single-day period", () => {
    const accruals = dailyAccruals(50000n, 1);
    expect(accruals).toHaveLength(1);
    expect(accruals[0]).toBe(50000n);
  });

  it("handles zero amount", () => {
    const accruals = dailyAccruals(0n, 30);
    expect(accruals).toHaveLength(30);
    expect(accruals.every((a) => a === 0n)).toBe(true);
  });

  it("handles large annual subscription (365 days)", () => {
    // ₹12,000 annual = 1,200,000 paise over 365 days
    const total = 1200000n;
    const accruals = dailyAccruals(total, 365);
    expect(accruals).toHaveLength(365);
    const sum = accruals.reduce((a, b) => a + b, 0n);
    expect(sum).toBe(total);
    // First 364 days should be equal
    const daily = total / 365n; // 3287n
    for (let i = 0; i < 364; i++) {
      expect(accruals[i]).toBe(daily);
    }
    // Last day gets remainder
    const remainder = total - daily * 365n; // 1200000 - 3287*365 = 1200000 - 1199755 = 245
    expect(accruals[364]).toBe(daily + remainder);
  });

  it("handles very small amount (1 paise) over many days", () => {
    // 1 paise over 30 days: first 29 days get 0, last day gets 1
    const accruals = dailyAccruals(1n, 30);
    expect(accruals).toHaveLength(30);
    const sum = accruals.reduce((a, b) => a + b, 0n);
    expect(sum).toBe(1n);
    expect(accruals[29]).toBe(1n);
  });

  it("throws if totalDays < 1", () => {
    expect(() => dailyAccruals(1000n, 0)).toThrow("totalDays must be at least 1");
  });

  it("throws if totalPaise < 0", () => {
    expect(() => dailyAccruals(-1n, 10)).toThrow("totalPaise must be non-negative");
  });
});

describe("revenue domain — computeDeferredBalance", () => {
  it("returns full amount when nothing recognized", () => {
    expect(computeDeferredBalance(100000n, 0n)).toBe(100000n);
  });

  it("returns zero when fully recognized", () => {
    expect(computeDeferredBalance(100000n, 100000n)).toBe(0n);
  });

  it("returns correct partial balance", () => {
    expect(computeDeferredBalance(100000n, 40000n)).toBe(60000n);
  });

  it("maintains invariant: recognized + deferred = total", () => {
    const total = 999999n;
    const recognized = 333333n;
    const deferred = computeDeferredBalance(total, recognized);
    expect(recognized + deferred).toBe(total);
  });
});

describe("revenue domain — computeTotalDays", () => {
  it("computes days for monthly period", () => {
    // Jan 1 to Feb 1 = 31 days
    const days = computeTotalDays("2025-01-01", "2025-02-01");
    expect(days).toBe(31);
  });

  it("computes days for annual period", () => {
    const days = computeTotalDays("2025-01-01", "2026-01-01");
    expect(days).toBe(365);
  });

  it("returns 1 for same-day", () => {
    const days = computeTotalDays("2025-06-15", "2025-06-15");
    expect(days).toBe(1);
  });

  it("computes short period (7 days)", () => {
    const days = computeTotalDays("2025-03-01", "2025-03-08");
    expect(days).toBe(7);
  });
});

describe("revenue domain — isFullyRecognized", () => {
  it("returns true when recognized >= total", () => {
    expect(isFullyRecognized(100000n, 100000n)).toBe(true);
  });

  it("returns false when recognized < total", () => {
    expect(isFullyRecognized(50000n, 100000n)).toBe(false);
  });
});

describe("revenue domain — invariant: sum(accruals) === total for various periods", () => {
  const testCases = [
    { total: 100n, days: 7 },
    { total: 99999n, days: 28 },
    { total: 1200000n, days: 30 },
    { total: 5000000n, days: 365 },
    { total: 1n, days: 1 },
    { total: 7n, days: 3 },
    { total: 10000000n, days: 366 }, // leap year
  ];

  for (const { total, days } of testCases) {
    it(`sum(dailyAccruals(${total}n, ${days})) === ${total}n`, () => {
      const accruals = dailyAccruals(BigInt(total), days);
      const sum = accruals.reduce((a, b) => a + b, 0n);
      expect(sum).toBe(BigInt(total));
    });
  }
});

describe("revenue domain — invariant: recognized + deferred === total (progressive)", () => {
  it("holds after each day of accrual", () => {
    const total = 100000n;
    const days = 30;
    const accruals = dailyAccruals(total, days);

    let recognized = 0n;
    for (let i = 0; i < days; i++) {
      recognized += accruals[i]!;
      const deferred = computeDeferredBalance(total, recognized);
      expect(recognized + deferred).toBe(total);
    }
    // After all days, fully recognized
    expect(recognized).toBe(total);
    expect(computeDeferredBalance(total, recognized)).toBe(0n);
  });
});
