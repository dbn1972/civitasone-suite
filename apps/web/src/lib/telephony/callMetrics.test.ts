import { describe, it, expect } from "vitest";
import { toCallMetrics, callMetricsPath, metricsToSummary } from "./callMetrics";

const PAYLOAD = {
  total: 1200,
  byStatus: { queued: 2, ringing: 1, answered: 5, completed: 1000, missed: 10, abandoned: 182 },
  live: 3,
  answered: 1005,
  slaScored: 1005,
  slaMet: 800,
  slaPct: 80,
  completed: 1000,
  dispositions: [
    { disposition: "resolved", count: 700 },
    { disposition: null, count: 300 },
  ],
  abandoned: 182,
};

describe("toCallMetrics", () => {
  it("maps the server aggregate (counts well beyond one 50-row page)", () => {
    const m = toCallMetrics(PAYLOAD)!;
    expect(m.total).toBe(1200);
    expect(m.live).toBe(3);
    expect(m.abandoned).toBe(182);
    expect(m.answered).toBe(1005); // byStatus answered + completed
    expect(m.completed).toBe(1000);
    expect(m.dispositions).toEqual([
      { disposition: "resolved", count: 700 },
      { disposition: null, count: 300 },
    ]);
  });

  it("keeps a null slaPct (nothing scored) instead of inventing 100", () => {
    expect(toCallMetrics({ ...PAYLOAD, slaScored: 0, slaMet: 0, slaPct: null })!.slaPct).toBeNull();
  });

  it("returns null (so the UI shows dashes, not zeros) for anything that is not the metrics shape", () => {
    expect(toCallMetrics(null)).toBeNull();
    expect(toCallMetrics([])).toBeNull();
    expect(toCallMetrics({ data: [] })).toBeNull();
    expect(toCallMetrics({ ...PAYLOAD, total: "1200" })).toBeNull();
    expect(toCallMetrics({ ...PAYLOAD, dispositions: [{ disposition: 3, count: 1 }] })).toBeNull();
  });
});

describe("metricsToSummary / callMetricsPath", () => {
  it("projects onto the summary the cards render", () => {
    expect(metricsToSummary(toCallMetrics(PAYLOAD)!)).toEqual({
      total: 1200, live: 3, answered: 1005, abandoned: 182, slaScored: 1005, slaMet: 800, slaPct: 80,
    });
  });
  it("encodes the window", () => {
    expect(callMetricsPath(null)).toBe("/v1/telephony/calls/metrics");
    expect(callMetricsPath("2026-09-01T00:00:00.000Z")).toBe("/v1/telephony/calls/metrics?from=2026-09-01T00%3A00%3A00.000Z");
  });
});
