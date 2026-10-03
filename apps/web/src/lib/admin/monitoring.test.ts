import { describe, it, expect } from "vitest";
import { normaliseStatus, countApiStatuses, countEditions, toApiEndpointRow, toEditionRow } from "./monitoring";

// GAP-ADMIN-API-MONITORING-04
describe("countApiStatuses", () => {
  it("does not count maintenance / unknown / missing statuses as Down", () => {
    const c = countApiStatuses([
      { status: "healthy" },
      { status: "degraded" },
      { status: "down" },
      { status: "maintenance" },
      { status: undefined },
    ]);
    expect(c).toEqual({ endpoints: 5, healthy: 1, degraded: 1, down: 1, other: 2 });
  });

  it("normalises case and separators", () => {
    const c = countApiStatuses([{ status: "HEALTHY" }, { status: "partial_outage" }, { status: "Unhealthy" }]);
    expect(c).toMatchObject({ healthy: 1, degraded: 1, down: 1, other: 0 });
  });
});

// GAP-ADMIN-EDITIONS-04
describe("countEditions", () => {
  it("separates active, deprecated and draft; sums tenants without float math surprises", () => {
    const c = countEditions([
      { status: "active", tenants: 3 },
      { status: "draft", tenants: "0" },
      { status: "deprecated", tenants: 2 },
    ]);
    expect(c).toEqual({ total: 3, active: 1, deprecated: 1, other: 1, tenants: 5 });
  });

  it("ignores a non-numeric tenants value instead of producing NaN", () => {
    expect(countEditions([{ status: "active", tenants: "n/a" }]).tenants).toBe(0);
  });
});

// GAP-ADMIN-API-MONITORING-05 / GAP-ADMIN-EDITIONS-06
describe("row mappers", () => {
  it("default a missing status to 'unknown' and keep extra fields", () => {
    expect(toApiEndpointRow({ service: "x", endpoint: "/a", extra: 1 })).toMatchObject({ status: "unknown", extra: 1, service: "x" });
    expect(toEditionRow({ name: "Pro" })).toMatchObject({ status: "unknown", tenants: 0, name: "Pro" });
  });
});

describe("normaliseStatus", () => {
  it("passes real values through and maps missing / blank / non-scalar to 'unknown'", () => {
    expect(normaliseStatus("healthy")).toBe("healthy");
    expect(normaliseStatus(1)).toBe("1");
    expect(normaliseStatus(null)).toBe("unknown");
    expect(normaliseStatus(undefined)).toBe("unknown");
    expect(normaliseStatus("  ")).toBe("unknown");
    expect(normaliseStatus({ a: 1 })).toBe("unknown");
  });
});

// GAP-ADMIN-API-MONITORING-06
import { errorRateView, formatLatencyMs, isSnapshotStale, newestCheckedAt, parseErrorRatePct, API_SNAPSHOT_STALE_MS } from "./monitoring";

describe("api-monitoring units and freshness", () => {
  it("parses percent numbers and strings, rejects anything outside 0-100", () => {
    expect(parseErrorRatePct(1.25)).toBe(1.25);
    expect(parseErrorRatePct("2.5%")).toBe(2.5);
    expect(parseErrorRatePct(" 3 ")).toBe(3);
    expect(parseErrorRatePct(-1)).toBeNull();
    expect(parseErrorRatePct(140)).toBeNull();
    expect(parseErrorRatePct("n/a")).toBeNull();
    expect(parseErrorRatePct(null)).toBeNull();
  });
  it("tones: <1 good, 1-<5 warn, >=5 bad, unreported neutral", () => {
    expect(errorRateView(0.99).tone).toBe("good");
    expect(errorRateView(1).tone).toBe("warn");
    expect(errorRateView(4.99).tone).toBe("warn");
    expect(errorRateView(5).tone).toBe("bad");
    expect(errorRateView(undefined)).toMatchObject({ tone: "mut", text: "\u2014" });
    expect(errorRateView(12.3456).text).toBe("12.35%");
  });
  it("latency in ms; missing or negative is a dash", () => {
    expect(formatLatencyMs(87.4)).toBe("87 ms");
    expect(formatLatencyMs("120")).toBe("120 ms");
    expect(formatLatencyMs(null)).toBe("\u2014");
    expect(formatLatencyMs(-5)).toBe("\u2014");
    expect(formatLatencyMs("")).toBe("\u2014");
  });
  it("newest checkedAt ignores junk; staleness is judged against the threshold", () => {
    expect(newestCheckedAt([{ checkedAt: "2026-10-01T10:00:00Z" }, { checkedAt: "garbage" }, { checkedAt: "2026-10-01T11:00:00Z" }, {}])).toBe("2026-10-01T11:00:00.000Z");
    expect(newestCheckedAt([{ checkedAt: "" }])).toBeNull();
    const t = "2026-10-01T11:00:00.000Z";
    const base = Date.parse(t);
    expect(isSnapshotStale(t, base + API_SNAPSHOT_STALE_MS)).toBe(false);
    expect(isSnapshotStale(t, base + API_SNAPSHOT_STALE_MS + 1)).toBe(true);
    expect(isSnapshotStale(null, base)).toBe(false);
  });
  it("toApiEndpointRow takes the row's own time, else the envelope generatedAt", () => {
    expect(toApiEndpointRow({ service: "a", checkedAt: "2026-10-01T09:00:00Z" }, "2026-10-01T11:00:00Z").checkedAt).toBe("2026-10-01T09:00:00Z");
    expect(toApiEndpointRow({ service: "a", lastCheckedAt: "2026-10-01T08:00:00Z" }).checkedAt).toBe("2026-10-01T08:00:00Z");
    expect(toApiEndpointRow({ service: "a" }, "2026-10-01T11:00:00Z").checkedAt).toBe("2026-10-01T11:00:00Z");
    expect(toApiEndpointRow({ service: "a", checkedAt: "bad" }).checkedAt).toBe("");
  });
});
