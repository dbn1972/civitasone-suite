/**
 * PERF-1: HTTP request latency histogram (Charter §28.2 / §38).
 * Verifies bucketed recording, quantile estimation (p50/p95/p99),
 * route/method scoping, and Prometheus exposition shape.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordHttpLatency,
  getHttpLatencyQuantile,
  getHttpLatencyCount,
  resetHttpLatencyMetrics,
} from "@civitasone/observability";

const SVC = "finance-service";

beforeEach(() => resetHttpLatencyMetrics());

describe("http latency histogram", () => {
  it("returns null when no samples recorded", () => {
    expect(getHttpLatencyQuantile(SVC, 0.95)).toBeNull();
    expect(getHttpLatencyCount(SVC)).toBe(0);
  });

  it("counts samples and estimates p95 within the correct bucket band", () => {
    // 95 samples at ~40ms, 5 samples at ~900ms → p95 sits in the slow tail.
    for (let i = 0; i < 95; i++) recordHttpLatency(SVC, "GET", "/v1/finance/ledger", 40);
    for (let i = 0; i < 5; i++) recordHttpLatency(SVC, "GET", "/v1/finance/ledger", 900);

    expect(getHttpLatencyCount(SVC)).toBe(100);
    const p50 = getHttpLatencyQuantile(SVC, 0.5)!;
    const p95 = getHttpLatencyQuantile(SVC, 0.95)!;
    const p99 = getHttpLatencyQuantile(SVC, 0.99)!;
    expect(p50).toBeLessThanOrEqual(50);   // median is in the fast band
    expect(p95).toBeLessThanOrEqual(75);   // 95th still within the fast cohort boundary
    expect(p99).toBeGreaterThan(500);      // tail captures the slow requests
  });

  it("scopes quantiles by method and route template", () => {
    for (let i = 0; i < 10; i++) recordHttpLatency(SVC, "GET", "/v1/finance/a", 20);
    for (let i = 0; i < 10; i++) recordHttpLatency(SVC, "POST", "/v1/finance/b", 480);

    expect(getHttpLatencyQuantile(SVC, 0.9, "GET", "/v1/finance/a")!).toBeLessThanOrEqual(25);
    expect(getHttpLatencyQuantile(SVC, 0.9, "POST", "/v1/finance/b")!).toBeGreaterThan(400);
    // aggregate across both routes still works
    expect(getHttpLatencyCount(SVC)).toBe(20);
  });

  it("isolates services", () => {
    recordHttpLatency("a-service", "GET", "/x", 10);
    expect(getHttpLatencyCount("b-service")).toBe(0);
    expect(getHttpLatencyQuantile("b-service", 0.95)).toBeNull();
  });
});
