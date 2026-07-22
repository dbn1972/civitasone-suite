/**
 * Tests for modules/analytics/domain.ts
 *
 * Covers: computeDailyMetrics, computeTrends (weekly + monthly).
 */
import { describe, expect, it } from "vitest";
import {
  computeDailyMetrics,
  computeTrends,
  type VisitRecord,
  type DailyMetric,
} from "../src/modules/analytics/domain.js";

describe("computeDailyMetrics", () => {
  it("returns zeroed metrics for empty input", () => {
    const result = computeDailyMetrics([]);

    expect(result.totalVisits).toBe(0);
    expect(result.uniqueVisitors).toBe(0);
    expect(result.avgApprovalTurnaroundMs).toBeNull();
    expect(result.avgVisitDurationMs).toBeNull();
    expect(result.peakHourDistribution).toEqual({});
    expect(result.noShowRate).toBe(0);
  });

  it("counts total visits correctly", () => {
    const visits: VisitRecord[] = [
      makeVisit({ visitId: "v1" }),
      makeVisit({ visitId: "v2" }),
      makeVisit({ visitId: "v3" }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.totalVisits).toBe(3);
  });

  it("counts unique visitors by visitorId", () => {
    const visits: VisitRecord[] = [
      makeVisit({ visitId: "v1", visitorId: "visitor-A" }),
      makeVisit({ visitId: "v2", visitorId: "visitor-A" }),
      makeVisit({ visitId: "v3", visitorId: "visitor-B" }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.uniqueVisitors).toBe(2);
  });

  it("computes average approval turnaround correctly", () => {
    const base = new Date("2025-06-15T08:00:00Z");
    const visits: VisitRecord[] = [
      makeVisit({
        visitId: "v1",
        createdAt: base,
        approvedAt: new Date(base.getTime() + 60_000), // 1 min
      }),
      makeVisit({
        visitId: "v2",
        createdAt: base,
        approvedAt: new Date(base.getTime() + 120_000), // 2 min
      }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.avgApprovalTurnaroundMs).toBe(90_000); // (60k + 120k) / 2
  });

  it("returns null approval turnaround when no visits are approved", () => {
    const visits: VisitRecord[] = [
      makeVisit({ visitId: "v1", approvedAt: null }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.avgApprovalTurnaroundMs).toBeNull();
  });

  it("computes average visit duration correctly", () => {
    const visits: VisitRecord[] = [
      makeVisit({
        visitId: "v1",
        checkedInAt: new Date("2025-06-15T09:00:00Z"),
        checkedOutAt: new Date("2025-06-15T11:00:00Z"), // 2 hours
      }),
      makeVisit({
        visitId: "v2",
        checkedInAt: new Date("2025-06-15T10:00:00Z"),
        checkedOutAt: new Date("2025-06-15T14:00:00Z"), // 4 hours
      }),
    ];

    const result = computeDailyMetrics(visits);
    // (2h + 4h) / 2 = 3h = 10_800_000 ms
    expect(result.avgVisitDurationMs).toBe(10_800_000);
  });

  it("returns null duration when no visits have check-in/check-out", () => {
    const visits: VisitRecord[] = [
      makeVisit({ visitId: "v1", checkedInAt: null, checkedOutAt: null }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.avgVisitDurationMs).toBeNull();
  });

  it("computes peak hour distribution correctly", () => {
    const visits: VisitRecord[] = [
      makeVisit({ visitId: "v1", checkedInAt: new Date("2025-06-15T09:30:00Z") }),
      makeVisit({ visitId: "v2", checkedInAt: new Date("2025-06-15T09:45:00Z") }),
      makeVisit({ visitId: "v3", checkedInAt: new Date("2025-06-15T14:00:00Z") }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.peakHourDistribution[9]).toBe(2);
    expect(result.peakHourDistribution[14]).toBe(1);
  });

  it("omits hours with zero check-ins from distribution", () => {
    const visits: VisitRecord[] = [
      makeVisit({ visitId: "v1", checkedInAt: new Date("2025-06-15T10:00:00Z") }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.peakHourDistribution[10]).toBe(1);
    expect(result.peakHourDistribution[0]).toBeUndefined();
  });

  it("computes no-show rate correctly", () => {
    const visits: VisitRecord[] = [
      makeVisit({ visitId: "v1", status: "checked_out" }),
      makeVisit({ visitId: "v2", status: "no_show" }),
      makeVisit({ visitId: "v3", status: "no_show" }),
      makeVisit({ visitId: "v4", status: "approved" }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.noShowRate).toBe(0.5); // 2/4
  });

  it("returns 0 no-show rate when no no-shows", () => {
    const visits: VisitRecord[] = [
      makeVisit({ visitId: "v1", status: "checked_out" }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.noShowRate).toBe(0);
  });

  it("ignores negative turnarounds (data anomaly)", () => {
    const visits: VisitRecord[] = [
      makeVisit({
        visitId: "v1",
        createdAt: new Date("2025-06-15T10:00:00Z"),
        approvedAt: new Date("2025-06-15T09:00:00Z"), // Before creation (anomaly)
      }),
      makeVisit({
        visitId: "v2",
        createdAt: new Date("2025-06-15T08:00:00Z"),
        approvedAt: new Date("2025-06-15T08:30:00Z"), // Valid: 30 min
      }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.avgApprovalTurnaroundMs).toBe(30 * 60 * 1000);
  });

  it("ignores negative visit durations (data anomaly)", () => {
    const visits: VisitRecord[] = [
      makeVisit({
        visitId: "v1",
        checkedInAt: new Date("2025-06-15T12:00:00Z"),
        checkedOutAt: new Date("2025-06-15T10:00:00Z"), // Before check-in (anomaly)
      }),
    ];

    const result = computeDailyMetrics(visits);
    expect(result.avgVisitDurationMs).toBeNull();
  });
});

describe("computeTrends", () => {
  it("returns empty buckets for empty input", () => {
    const result = computeTrends([], "weekly");

    expect(result.period).toBe("weekly");
    expect(result.buckets).toEqual([]);
  });

  it("groups daily metrics into weekly buckets", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-06-09T00:00:00Z"), totalVisits: 10 }), // Mon wk 24
      makeDailyMetric({ date: new Date("2025-06-10T00:00:00Z"), totalVisits: 15 }), // Tue wk 24
      makeDailyMetric({ date: new Date("2025-06-16T00:00:00Z"), totalVisits: 20 }), // Mon wk 25
    ];

    const result = computeTrends(metrics, "weekly");

    expect(result.period).toBe("weekly");
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0].totalVisits).toBe(25); // 10 + 15
    expect(result.buckets[1].totalVisits).toBe(20);
  });

  it("groups daily metrics into monthly buckets", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-05-01T00:00:00Z"), totalVisits: 100 }),
      makeDailyMetric({ date: new Date("2025-05-15T00:00:00Z"), totalVisits: 150 }),
      makeDailyMetric({ date: new Date("2025-06-01T00:00:00Z"), totalVisits: 200 }),
    ];

    const result = computeTrends(metrics, "monthly");

    expect(result.period).toBe("monthly");
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0].totalVisits).toBe(250); // May: 100 + 150
    expect(result.buckets[1].totalVisits).toBe(200); // June
  });

  it("sorts buckets chronologically", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-06-16T00:00:00Z"), totalVisits: 20 }),
      makeDailyMetric({ date: new Date("2025-06-09T00:00:00Z"), totalVisits: 10 }),
    ];

    const result = computeTrends(metrics, "weekly");
    expect(result.buckets[0].periodStart.getTime()).toBeLessThan(result.buckets[1].periodStart.getTime());
  });

  it("computes average approval time across days in a bucket", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-06-09T00:00:00Z"), avgApprovalTimeMs: 60_000 }),
      makeDailyMetric({ date: new Date("2025-06-10T00:00:00Z"), avgApprovalTimeMs: 120_000 }),
    ];

    const result = computeTrends(metrics, "weekly");
    expect(result.buckets[0].avgApprovalTimeMs).toBe(90_000); // (60k + 120k) / 2
  });

  it("handles null avgApprovalTimeMs in bucket aggregation", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-06-09T00:00:00Z"), avgApprovalTimeMs: null }),
      makeDailyMetric({ date: new Date("2025-06-10T00:00:00Z"), avgApprovalTimeMs: 60_000 }),
    ];

    const result = computeTrends(metrics, "weekly");
    expect(result.buckets[0].avgApprovalTimeMs).toBe(60_000);
  });

  it("returns null avgApprovalTimeMs when all days are null", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-06-09T00:00:00Z"), avgApprovalTimeMs: null }),
    ];

    const result = computeTrends(metrics, "weekly");
    expect(result.buckets[0].avgApprovalTimeMs).toBeNull();
  });

  it("computes peak hour as mode across days", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-06-09T00:00:00Z"), peakHour: 9 }),
      makeDailyMetric({ date: new Date("2025-06-10T00:00:00Z"), peakHour: 9 }),
      makeDailyMetric({ date: new Date("2025-06-11T00:00:00Z"), peakHour: 14 }),
    ];

    const result = computeTrends(metrics, "weekly");
    expect(result.buckets[0].peakHour).toBe(9); // mode
  });

  it("sums no-show counts across the period", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-06-09T00:00:00Z"), noShowCount: 2 }),
      makeDailyMetric({ date: new Date("2025-06-10T00:00:00Z"), noShowCount: 3 }),
    ];

    const result = computeTrends(metrics, "weekly");
    expect(result.buckets[0].noShowCount).toBe(5);
  });

  it("reports daysWithData correctly", () => {
    const metrics: DailyMetric[] = [
      makeDailyMetric({ date: new Date("2025-06-09T00:00:00Z") }),
      makeDailyMetric({ date: new Date("2025-06-11T00:00:00Z") }),
    ];

    const result = computeTrends(metrics, "weekly");
    expect(result.buckets[0].daysWithData).toBe(2);
  });
});

// ── Test Helpers ──────────────────────────────────────────────────────────

function makeVisit(overrides: Partial<VisitRecord> & { visitId: string }): VisitRecord {
  return {
    visitId: overrides.visitId,
    visitorId: overrides.visitorId ?? `visitor-${overrides.visitId}`,
    status: overrides.status ?? "approved",
    createdAt: overrides.createdAt ?? new Date("2025-06-15T08:00:00Z"),
    approvedAt: overrides.approvedAt ?? null,
    checkedInAt: overrides.checkedInAt ?? null,
    checkedOutAt: overrides.checkedOutAt ?? null,
  };
}

function makeDailyMetric(overrides: Partial<DailyMetric> & { date: Date }): DailyMetric {
  return {
    date: overrides.date,
    totalVisits: overrides.totalVisits ?? 10,
    uniqueVisitors: overrides.uniqueVisitors ?? 5,
    avgApprovalTimeMs: "avgApprovalTimeMs" in overrides ? overrides.avgApprovalTimeMs! : 60_000,
    avgVisitDurationMs: "avgVisitDurationMs" in overrides ? overrides.avgVisitDurationMs! : 3_600_000,
    peakHour: "peakHour" in overrides ? overrides.peakHour! : 10,
    noShowCount: overrides.noShowCount ?? 0,
  };
}
