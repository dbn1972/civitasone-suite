/**
 * SVC-039 — budget monitoring & forecasting pure domain tests. No DB/IO.
 */
import { describe, it, expect } from "vitest";
import {
  availableMinor, burnRateBps, utilisationBps, fyBounds, fractionElapsedBps,
  forecastYearEndMinor, classifyException, summarisePortfolio,
} from "../src/modules/budget/monitoring-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

const line = (a: bigint, c: bigint, act: bigint) => ({ allocatedMinor: a, committedMinor: c, actualMinor: act });

describe("monitoring — availableMinor()", () => {
  it("subtracts committed + actual from allocated", () => {
    expect(availableMinor(line(1000n, 200n, 300n))).toBe(500n);
    expect(availableMinor(line(1000n, 900n, 200n))).toBe(-100n); // over-committed
  });
});

describe("monitoring — burnRateBps() / utilisationBps()", () => {
  it("burn = expenditure / allocation in bps", () => {
    expect(burnRateBps(1000n, 250n)).toBe(2500n);
    expect(burnRateBps(1000n, 1200n)).toBe(12000n); // uncapped
  });
  it("returns 0 when allocation is 0", () => {
    expect(burnRateBps(0n, 100n)).toBe(0n);
    expect(utilisationBps(line(0n, 1n, 1n))).toBe(0n);
  });
  it("utilisation = (committed + actual) / allocation", () => {
    expect(utilisationBps(line(1000n, 200n, 300n))).toBe(5000n);
  });
});

describe("monitoring — fyBounds()", () => {
  it("returns 1 Apr .. 31 Mar for the FY", () => {
    const { start, end } = fyBounds("2025-26");
    expect(start.toISOString().slice(0, 10)).toBe("2025-04-01");
    expect(end.toISOString().slice(0, 10)).toBe("2026-03-31");
  });
  it("throws on malformed FY", () => {
    expect(() => fyBounds("2025")).toThrow(DomainError);
  });
});

describe("monitoring — fractionElapsedBps()", () => {
  it("is 0 before the FY starts", () => {
    expect(fractionElapsedBps("2025-26", new Date("2025-01-01T00:00:00Z"))).toBe(0n);
  });
  it("is 10000 on/after the last day", () => {
    expect(fractionElapsedBps("2025-26", new Date("2026-03-31T00:00:00Z"))).toBe(10000n);
    expect(fractionElapsedBps("2025-26", new Date("2026-06-01T00:00:00Z"))).toBe(10000n);
  });
  it("is roughly half mid-year", () => {
    const bps = fractionElapsedBps("2025-26", new Date("2025-09-30T00:00:00Z"));
    expect(bps).toBeGreaterThan(4800n);
    expect(bps).toBeLessThan(5200n);
  });
});

describe("monitoring — forecastYearEndMinor()", () => {
  it("straight-lines spend to year end", () => {
    expect(forecastYearEndMinor(500n, 5000n)).toBe(1000n); // half the year, half spent → double
  });
  it("returns current spend when no time elapsed", () => {
    expect(forecastYearEndMinor(500n, 0n)).toBe(500n);
  });
});

describe("monitoring — classifyException()", () => {
  const elapsed = 5000n; // half the year
  it("over_committed when available < 0", () => {
    expect(classifyException(line(1000n, 900n, 200n), elapsed)).toBe("over_committed");
  });
  it("projected_overspend when forecast exceeds allocation", () => {
    // actual 600 at half year → forecast 1200 > 1000
    expect(classifyException(line(1000n, 0n, 600n), elapsed)).toBe("projected_overspend");
  });
  it("under_utilised when burn lags the elapsed pace", () => {
    // actual 100 → burn 1000bps; 1000+2500=3500 < 5000 → under-utilised
    expect(classifyException(line(1000n, 0n, 100n), elapsed)).toBe("under_utilised");
  });
  it("on_track otherwise", () => {
    // actual 450 → forecast 900 (<1000); burn 4500; 4500+2500=7000 >= 5000 → on track
    expect(classifyException(line(1000n, 0n, 450n), elapsed)).toBe("on_track");
  });
});

describe("monitoring — summarisePortfolio()", () => {
  it("aggregates totals and counts exceptions", () => {
    const t = summarisePortfolio([
      line(1000n, 900n, 200n),  // over_committed
      line(1000n, 0n, 600n),    // projected_overspend
      line(1000n, 0n, 100n),    // under_utilised
      line(1000n, 0n, 450n),    // on_track
    ], 5000n);
    expect(t.count).toBe(4);
    expect(t.allocatedMinor).toBe(4000n);
    expect(t.actualMinor).toBe(1350n);
    expect(t.exceptions.over_committed).toBe(1);
    expect(t.exceptions.projected_overspend).toBe(1);
    expect(t.exceptions.under_utilised).toBe(1);
    expect(t.exceptions.on_track).toBe(1);
  });
  it("handles an empty portfolio", () => {
    const t = summarisePortfolio([], 5000n);
    expect(t.count).toBe(0);
    expect(t.allocatedMinor).toBe(0n);
  });
});
