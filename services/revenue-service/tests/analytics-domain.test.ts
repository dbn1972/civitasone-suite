/**
 * Analytics domain tests (SVC-140) — deterministic forecast math on known
 * series, aggregation correctness, and the no-float money invariant.
 */
import { describe, it, expect } from "vitest";
import {
  forecast,
  collectionEfficiencyBps,
  aggregatePeriodSeries,
  rankDefaulters,
  DomainError,
  type PeriodDcbEntry,
} from "../src/modules/analytics/domain.js";

describe("collectionEfficiencyBps", () => {
  it("computes collected/demanded in basis points", () => {
    expect(collectionEfficiencyBps(1000n, 500n)).toBe(5000);
    expect(collectionEfficiencyBps(1000n, 1000n)).toBe(10000);
  });
  it("returns 0 when there is no demand", () => {
    expect(collectionEfficiencyBps(0n, 500n)).toBe(0);
    expect(collectionEfficiencyBps(-5n, 500n)).toBe(0);
  });
  it("may exceed 100% when over-collected (arrears cleared)", () => {
    expect(collectionEfficiencyBps(1000n, 1500n)).toBe(15000);
  });
});

describe("aggregatePeriodSeries", () => {
  const entries: PeriodDcbEntry[] = [
    { period: "2024-05", entryType: "demand", amountMinor: 300000n },
    { period: "2024-04", entryType: "demand", amountMinor: 100000n },
    { period: "2024-04", entryType: "collection", amountMinor: 60000n },
    { period: "2024-05", entryType: "collection", amountMinor: 150000n },
    { period: "2024-04", entryType: "refund", amountMinor: 10000n },
  ];

  it("sorts ascending by period and splits demand vs collection", () => {
    const out = aggregatePeriodSeries(entries);
    expect(out.map((o) => o.period)).toEqual(["2024-04", "2024-05"]);
    expect(out[0]!.demandMinor).toBe(100000n);
    // collection + refund both count as collection-side
    expect(out[0]!.collectionMinor).toBe(70000n);
    expect(out[0]!.efficiencyBps).toBe(7000);
    expect(out[1]!.demandMinor).toBe(300000n);
    expect(out[1]!.collectionMinor).toBe(150000n);
    expect(out[1]!.efficiencyBps).toBe(5000);
  });

  it("handles empty input", () => {
    expect(aggregatePeriodSeries([])).toEqual([]);
  });
});

describe("rankDefaulters", () => {
  it("ranks descending, excludes non-positive, breaks ties by assesseeId", () => {
    const ranked = rankDefaulters(
      [
        { assesseeId: "b", outstandingMinor: 500n },
        { assesseeId: "a", outstandingMinor: 500n },
        { assesseeId: "c", outstandingMinor: 900n },
        { assesseeId: "d", outstandingMinor: 0n },
        { assesseeId: "e", outstandingMinor: -50n },
      ],
      10,
    );
    expect(ranked.map((r) => [r.assesseeId, r.rank])).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("respects the limit", () => {
    const ranked = rankDefaulters(
      [
        { assesseeId: "a", outstandingMinor: 100n },
        { assesseeId: "b", outstandingMinor: 200n },
        { assesseeId: "c", outstandingMinor: 300n },
      ],
      2,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.assesseeId).toBe("c");
  });
});

describe("forecast — straight_line (least squares)", () => {
  it("projects an exact linear trend", () => {
    const r = forecast([100n, 200n, 300n], "straight_line", 2);
    expect(r.method).toBe("straight_line");
    expect(r.projections.map((p) => p.projectionMinor)).toEqual([400n, 500n]);
    // perfect fit → zero error band, full confidence
    expect(r.madMinor).toBe(0n);
    expect(r.confidenceBps).toBe(10000);
    expect(r.projections[0]!.index).toBe(3);
    expect(r.projections[0]!.lowerMinor).toBe(400n);
    expect(r.projections[0]!.upperMinor).toBe(400n);
  });

  it("clamps negative projections to zero", () => {
    // steeply declining series would project below zero
    const r = forecast([1000n, 400n, 100n], "straight_line", 3);
    expect(r.projections.every((p) => p.projectionMinor >= 0n)).toBe(true);
  });
});

describe("forecast — moving_average", () => {
  it("averages the trailing window with a residual band", () => {
    const r = forecast([100n, 200n, 300n, 400n], "moving_average", 1, 2);
    expect(r.projections[0]!.projectionMinor).toBe(350n); // mean(300,400)
    expect(r.madMinor).toBe(150n); // in-sample MAD
    expect(r.confidenceBps).toBe(4000); // 10000 - 150*10000/250
    expect(r.projections[0]!.lowerMinor).toBe(200n);
    expect(r.projections[0]!.upperMinor).toBe(500n);
  });

  it("rolls the window across multi-step horizons", () => {
    const r = forecast([100n, 200n, 300n], "moving_average", 2, 3);
    // proj1 = mean(100,200,300)=200; proj2 = mean(200,300,200)=233
    expect(r.projections.map((p) => p.projectionMinor)).toEqual([200n, 233n]);
  });
});

describe("forecast — seasonal_naive", () => {
  it("repeats the trailing season", () => {
    const r = forecast([10n, 20n, 30n, 40n], "seasonal_naive", 2, 2);
    expect(r.projections.map((p) => p.projectionMinor)).toEqual([30n, 40n]);
    expect(r.madMinor).toBe(20n);
    expect(r.confidenceBps).toBe(2000);
  });
});

describe("forecast — validation", () => {
  it("rejects fewer than 2 history periods", () => {
    expect(() => forecast([100n], "straight_line", 1)).toThrow(DomainError);
    expect(() => forecast([100n], "straight_line", 1)).toThrow("at least 2 historical");
  });
  it("rejects horizon < 1", () => {
    expect(() => forecast([100n, 200n], "straight_line", 0)).toThrow("horizon must be >= 1");
  });
  it("rejects window/season length < 1", () => {
    expect(() => forecast([100n, 200n], "moving_average", 1, 0)).toThrow("must be >= 1");
  });
  it("rejects window/season length longer than history", () => {
    expect(() => forecast([100n, 200n], "seasonal_naive", 1, 5)).toThrow("exceeds history length");
  });
});

describe("no-float money invariant", () => {
  it("keeps projections as exact bigint paise for large values", () => {
    const big = 12_345_678_901_234_567_890n;
    const r = forecast([big, big * 2n], "straight_line", 1);
    expect(typeof r.projections[0]!.projectionMinor).toBe("bigint");
    expect(r.projections[0]!.projectionMinor).toBe(big * 3n); // exact extrapolation
  });

  it("uses floor division for non-divisible averages (never a float)", () => {
    const r = forecast([100n, 101n], "moving_average", 1, 2);
    // mean(100,101) = 100.5 → floors to 100n, stays bigint
    expect(r.projections[0]!.projectionMinor).toBe(100n);
    expect(typeof r.projections[0]!.projectionMinor).toBe("bigint");
  });
});
