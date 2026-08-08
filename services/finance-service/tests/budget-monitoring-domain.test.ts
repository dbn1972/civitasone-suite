/**
 * Budget Monitoring Domain — pure unit tests.
 *
 * Source: services/finance-service/src/modules/budget/monitoring-domain.ts
 * Covers: availability, burn rate, utilisation, FY bounds, fraction elapsed,
 * year-end forecast, exception classification, portfolio summary.
 */
import { describe, it, expect } from "vitest";
import {
  availableMinor,
  burnRateBps,
  utilisationBps,
  fyBounds,
  fractionElapsedBps,
  forecastYearEndMinor,
  classifyException,
  summarisePortfolio,
} from "../src/modules/budget/monitoring-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

describe("availableMinor", () => {
  it("returns allocated minus (committed + actual)", () => {
    expect(availableMinor({ allocatedMinor: 1_000_000n, committedMinor: 200_000n, actualMinor: 300_000n })).toBe(500_000n);
  });

  it("returns negative when over-committed", () => {
    expect(availableMinor({ allocatedMinor: 100n, committedMinor: 60n, actualMinor: 60n })).toBe(-20n);
  });
});

describe("burnRateBps", () => {
  it("returns 5000 (50%) when half spent", () => {
    expect(burnRateBps(1_000_000n, 500_000n)).toBe(5_000n);
  });

  it("returns 0 when allocated is zero", () => {
    expect(burnRateBps(0n, 100n)).toBe(0n);
  });

  it("can exceed 10000 (over 100% spend)", () => {
    expect(burnRateBps(100n, 200n)).toBe(20_000n);
  });

  it("returns 0 when nothing spent", () => {
    expect(burnRateBps(1_000_000n, 0n)).toBe(0n);
  });
});

describe("utilisationBps", () => {
  it("returns (committed+actual)/allocated in bps", () => {
    expect(utilisationBps({ allocatedMinor: 1_000n, committedMinor: 300n, actualMinor: 200n })).toBe(5_000n);
  });

  it("returns 0 when allocated is zero", () => {
    expect(utilisationBps({ allocatedMinor: 0n, committedMinor: 100n, actualMinor: 50n })).toBe(0n);
  });
});

describe("fyBounds", () => {
  it("returns 1 Apr to 31 Mar for 2025-26", () => {
    const { start, end } = fyBounds("2025-26");
    expect(start.getUTCFullYear()).toBe(2025);
    expect(start.getUTCMonth()).toBe(3); // April (0-indexed)
    expect(start.getUTCDate()).toBe(1);
    expect(end.getUTCFullYear()).toBe(2026);
    expect(end.getUTCMonth()).toBe(2); // March
    expect(end.getUTCDate()).toBe(31);
  });

  it("throws INVALID_FY for bad format", () => {
    expect(() => fyBounds("2025")).toThrow(DomainError);
    expect(() => fyBounds("2025-2026")).toThrow(DomainError);
  });
});

describe("fractionElapsedBps", () => {
  it("returns 0 before FY starts", () => {
    expect(fractionElapsedBps("2025-26", new Date("2025-03-15"))).toBe(0n);
  });

  it("returns 10000 on/after FY ends (31 Mar)", () => {
    expect(fractionElapsedBps("2025-26", new Date("2026-04-01"))).toBe(10_000n);
  });

  it("returns ~5000 at mid-year (around Oct 1)", () => {
    const mid = fractionElapsedBps("2025-26", new Date("2025-10-01"));
    // 183 days out of 365 ≈ 5014 bps (approx, depends on exact calculation)
    expect(mid > 4_900n).toBe(true);
    expect(mid < 5_100n).toBe(true);
  });
});

describe("forecastYearEndMinor", () => {
  it("extrapolates: at 50% elapsed with 500_000 spent → forecast 1_000_000", () => {
    expect(forecastYearEndMinor(500_000n, 5_000n)).toBe(1_000_000n);
  });

  it("returns actualMinor when elapsedBps is 0 (cannot extrapolate)", () => {
    expect(forecastYearEndMinor(100_000n, 0n)).toBe(100_000n);
  });

  it("returns actual at 100% elapsed", () => {
    expect(forecastYearEndMinor(800_000n, 10_000n)).toBe(800_000n);
  });
});

describe("classifyException", () => {
  it("over_committed when available < 0", () => {
    expect(classifyException({ allocatedMinor: 100n, committedMinor: 60n, actualMinor: 60n }, 5_000n)).toBe("over_committed");
  });

  it("projected_overspend when forecast > allocated", () => {
    // At 25% elapsed, spent 400_000 of 1_000_000 → forecast = 1_600_000 > 1_000_000
    expect(classifyException({ allocatedMinor: 1_000_000n, committedMinor: 0n, actualMinor: 400_000n }, 2_500n)).toBe("projected_overspend");
  });

  it("under_utilised when burn lags pace by > gap (25%)", () => {
    // At 80% elapsed, only 10% spent → under-utilised
    expect(classifyException({ allocatedMinor: 1_000_000n, committedMinor: 0n, actualMinor: 100_000n }, 8_000n)).toBe("under_utilised");
  });

  it("on_track when all checks pass", () => {
    // At 50% elapsed, 45% spent → within 25% gap → on track
    expect(classifyException({ allocatedMinor: 1_000_000n, committedMinor: 0n, actualMinor: 450_000n }, 5_000n)).toBe("on_track");
  });
});

describe("summarisePortfolio", () => {
  it("aggregates multiple lines", () => {
    const lines = [
      { allocatedMinor: 1_000_000n, committedMinor: 200_000n, actualMinor: 300_000n },
      { allocatedMinor: 500_000n, committedMinor: 100_000n, actualMinor: 100_000n },
    ];
    const result = summarisePortfolio(lines, 5_000n);
    expect(result.count).toBe(2);
    expect(result.allocatedMinor).toBe(1_500_000n);
    expect(result.committedMinor).toBe(300_000n);
    expect(result.actualMinor).toBe(400_000n);
    expect(result.availableMinor).toBe(800_000n);
  });

  it("handles empty array", () => {
    const result = summarisePortfolio([], 5_000n);
    expect(result.count).toBe(0);
    expect(result.allocatedMinor).toBe(0n);
    expect(result.exceptions.on_track).toBe(0);
  });
});
