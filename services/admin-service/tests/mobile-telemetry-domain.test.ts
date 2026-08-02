/**
 * CR-MOB-01 — unit tests for the mobile telemetry domain logic.
 *
 * Two concerns: (1) bounds on untrusted client input, which must REJECT rather
 * than clamp, and (2) the percentile / rate aggregation arithmetic.
 */
import { describe, it, expect } from "vitest";
import { HttpError } from "../src/shared/context.js";
import {
  BOUNDS,
  PLATFORMS,
  assertRecordedAtInWindow,
  assertCountsConsistent,
  assertScreensUnique,
  percentile,
  ratePerThousand,
  aggregateTelemetry,
  aggregateScreens,
  type AggregateSample,
  type ScreenSample,
} from "../src/modules/health/mobile-domain.js";

function expectHttpError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).code).toBe(code);
    return;
  }
  throw new Error(`expected an HttpError ${status} ${code}, nothing was thrown`);
}

const NOW = new Date("2026-07-01T12:00:00.000Z");

describe("CR-MOB-01 bounds", () => {
  it("matches the CHECK constraints in migration 0027", () => {
    expect(BOUNDS.coldStartMsMax).toBe(120_000);
    expect(BOUNDS.warmStartMsMax).toBe(120_000);
    expect(BOUNDS.renderMsMax).toBe(60_000);
    expect(BOUNDS.crashCountMax).toBe(10_000);
    expect(BOUNDS.anrCountMax).toBe(10_000);
    expect(BOUNDS.sessionCountMin).toBe(1);
    expect(BOUNDS.sessionCountMax).toBe(100_000);
  });

  it("bounds the batch size and the clock window", () => {
    expect(BOUNDS.screensPerBatchMax).toBe(50);
    expect(BOUNDS.futureSkewMs).toBe(5 * 60_000);
    expect(BOUNDS.maxAgeMs).toBe(7 * 24 * 60 * 60_000);
  });

  it("supports exactly the two mobile platforms", () => {
    expect(PLATFORMS).toEqual(["ios", "android"]);
  });
});

describe("assertRecordedAtInWindow", () => {
  it("accepts a timestamp recorded now and returns it as a Date", () => {
    const t = assertRecordedAtInWindow(NOW.toISOString(), NOW);
    expect(t.toISOString()).toBe(NOW.toISOString());
  });

  it("accepts a small clock skew ahead of the server", () => {
    const ahead = new Date(NOW.getTime() + 4 * 60_000).toISOString();
    expect(() => assertRecordedAtInWindow(ahead, NOW)).not.toThrow();
  });

  it("accepts a timestamp exactly at the future-skew boundary", () => {
    const edge = new Date(NOW.getTime() + BOUNDS.futureSkewMs).toISOString();
    expect(() => assertRecordedAtInWindow(edge, NOW)).not.toThrow();
  });

  it("422 RECORDED_AT_IN_FUTURE just past the skew boundary", () => {
    const tooFar = new Date(NOW.getTime() + BOUNDS.futureSkewMs + 1_000).toISOString();
    expectHttpError(() => assertRecordedAtInWindow(tooFar, NOW), 422, "RECORDED_AT_IN_FUTURE");
  });

  it("accepts a timestamp exactly at the retention boundary", () => {
    const edge = new Date(NOW.getTime() - BOUNDS.maxAgeMs).toISOString();
    expect(() => assertRecordedAtInWindow(edge, NOW)).not.toThrow();
  });

  it("422 RECORDED_AT_TOO_OLD beyond the 7-day retention window", () => {
    const old = new Date(NOW.getTime() - BOUNDS.maxAgeMs - 60_000).toISOString();
    expectHttpError(() => assertRecordedAtInWindow(old, NOW), 422, "RECORDED_AT_TOO_OLD");
  });

  it("400 for a value that is not a timestamp at all", () => {
    expectHttpError(() => assertRecordedAtInWindow("not-a-date", NOW), 400, "VALIDATION_FAILED");
  });

  it("treats an offset timestamp as the same instant as its UTC form (timestamptz)", () => {
    // 17:30 +05:30 is 12:00Z — the same instant, so it must be accepted.
    const t = assertRecordedAtInWindow("2026-07-01T17:30:00+05:30", NOW);
    expect(t.toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("defaults `now` to the current clock when not supplied", () => {
    expect(() => assertRecordedAtInWindow(new Date().toISOString())).not.toThrow();
  });
});

describe("assertCountsConsistent", () => {
  it("accepts crash and ANR counts within the session count", () => {
    expect(() => assertCountsConsistent(2, 1, 10)).not.toThrow();
  });

  it("accepts counts exactly equal to the session count", () => {
    expect(() => assertCountsConsistent(5, 5, 5)).not.toThrow();
  });

  it("accepts all zeroes against one session", () => {
    expect(() => assertCountsConsistent(0, 0, 1)).not.toThrow();
  });

  it("422 CRASH_EXCEEDS_SESSIONS for an arithmetically impossible crash count", () => {
    expectHttpError(() => assertCountsConsistent(6, 0, 5), 422, "CRASH_EXCEEDS_SESSIONS");
  });

  it("422 ANR_EXCEEDS_SESSIONS for an arithmetically impossible ANR count", () => {
    expectHttpError(() => assertCountsConsistent(0, 6, 5), 422, "ANR_EXCEEDS_SESSIONS");
  });

  it("reports the crash problem first when both are broken", () => {
    expectHttpError(() => assertCountsConsistent(9, 9, 1), 422, "CRASH_EXCEEDS_SESSIONS");
  });
});

describe("assertScreensUnique", () => {
  it("accepts distinct screen names", () => {
    expect(() => assertScreensUnique([
      { screen: "Home", renderMs: 1, sampleCount: 1 },
      { screen: "Profile", renderMs: 1, sampleCount: 1 },
    ])).not.toThrow();
  });

  it("accepts an empty batch", () => {
    expect(() => assertScreensUnique([])).not.toThrow();
  });

  it("422 DUPLICATE_SCREEN for a repeated name", () => {
    expectHttpError(() => assertScreensUnique([
      { screen: "Home", renderMs: 1, sampleCount: 1 },
      { screen: "Home", renderMs: 2, sampleCount: 1 },
    ]), 422, "DUPLICATE_SCREEN");
  });

  it("422 DUPLICATE_SCREEN for a name repeated in a different case", () => {
    expectHttpError(() => assertScreensUnique([
      { screen: "Home", renderMs: 1, sampleCount: 1 },
      { screen: "HOME", renderMs: 2, sampleCount: 1 },
    ]), 422, "DUPLICATE_SCREEN");
  });
});

describe("percentile", () => {
  it("returns 0 for an empty sample rather than NaN", () => {
    expect(percentile([], 95)).toBe(0);
  });

  it("returns the only value for a single-element sample", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
  });

  it("computes nearest-rank p50 and p95 over ten values", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 95)).toBe(10);
    expect(percentile(v, 100)).toBe(10);
  });

  it("does not depend on input order", () => {
    expect(percentile([10, 1, 5], 50)).toBe(percentile([1, 5, 10], 50));
  });

  it("does not mutate the caller's array", () => {
    const v = [3, 1, 2];
    percentile(v, 50);
    expect(v).toEqual([3, 1, 2]);
  });

  it("clamps a percentile above 100 and below 0", () => {
    const v = [1, 2, 3];
    expect(percentile(v, 150)).toBe(3);
    expect(percentile(v, -20)).toBe(1);
  });
});

describe("ratePerThousand", () => {
  it("returns 0 when there are no sessions, never Infinity", () => {
    expect(ratePerThousand(5, 0)).toBe(0);
    expect(ratePerThousand(5, -1)).toBe(0);
  });

  it("scales per 1000 sessions", () => {
    expect(ratePerThousand(1, 1000)).toBe(1);
    expect(ratePerThousand(5, 500)).toBe(10);
  });

  it("rounds to two decimals", () => {
    expect(ratePerThousand(1, 3000)).toBe(0.33);
    expect(ratePerThousand(2, 3000)).toBe(0.67);
  });

  it("returns 0 for zero events", () => {
    expect(ratePerThousand(0, 1000)).toBe(0);
  });
});

describe("aggregateTelemetry", () => {
  const sample = (platform: string, appVersion: string, coldStartMs: number, crashCount = 0, anrCount = 0, sessionCount = 1): AggregateSample =>
    ({ platform, appVersion, coldStartMs, crashCount, anrCount, sessionCount });

  it("returns no buckets for no samples", () => {
    expect(aggregateTelemetry([])).toEqual([]);
  });

  it("groups by platform AND app version", () => {
    const out = aggregateTelemetry([
      sample("ios", "1.0.0", 100),
      sample("ios", "1.1.0", 200),
      sample("android", "1.0.0", 300),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((b) => `${b.platform}/${b.appVersion}`)).toEqual([
      "android/1.0.0", "ios/1.0.0", "ios/1.1.0",
    ]);
  });

  it("summarises cold start p50, p95 and max within a bucket", () => {
    const out = aggregateTelemetry([
      sample("ios", "1.0.0", 100),
      sample("ios", "1.0.0", 200),
      sample("ios", "1.0.0", 900),
    ]);
    expect(out[0]).toMatchObject({ eventCount: 3, coldStartP50Ms: 200, coldStartP95Ms: 900, coldStartMaxMs: 900 });
  });

  it("sums sessions, crashes and ANRs and derives the per-1000 rates", () => {
    const out = aggregateTelemetry([
      sample("android", "2.0.0", 100, 3, 1, 500),
      sample("android", "2.0.0", 150, 2, 1, 500),
    ]);
    expect(out[0]).toMatchObject({
      sessionCount: 1000, crashCount: 5, anrCount: 2,
      crashesPerThousandSessions: 5, anrsPerThousandSessions: 2,
    });
  });

  it("reports zero rates when a bucket has no sessions", () => {
    const out = aggregateTelemetry([sample("ios", "1.0.0", 100, 0, 0, 0)]);
    expect(out[0]?.crashesPerThousandSessions).toBe(0);
    expect(out[0]?.anrsPerThousandSessions).toBe(0);
  });

  it("sorts buckets by platform then app version for a stable response", () => {
    const out = aggregateTelemetry([
      sample("ios", "2.0.0", 1), sample("android", "3.0.0", 1), sample("ios", "1.0.0", 1),
    ]);
    expect(out.map((b) => `${b.platform} ${b.appVersion}`)).toEqual([
      "android 3.0.0", "ios 1.0.0", "ios 2.0.0",
    ]);
  });

  it("keeps versions that differ only by suffix in separate buckets", () => {
    const out = aggregateTelemetry([sample("ios", "1.0.0", 1), sample("ios", "1.0.0-rc1", 1)]);
    expect(out).toHaveLength(2);
  });
});

describe("aggregateScreens", () => {
  const s = (screen: string, renderMs: number, sampleCount = 1): ScreenSample => ({ screen, renderMs, sampleCount });

  it("returns no buckets for no samples", () => {
    expect(aggregateScreens([])).toEqual([]);
  });

  it("groups by screen and summarises render timings", () => {
    const out = aggregateScreens([s("Home", 100, 5), s("Home", 300, 5), s("Profile", 50, 2)]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      screen: "Home", observations: 2, sampleCount: 10,
      renderP50Ms: 100, renderP95Ms: 300, renderMaxMs: 300,
    });
    expect(out[1]).toMatchObject({ screen: "Profile", observations: 1, sampleCount: 2, renderMaxMs: 50 });
  });

  it("sorts buckets by screen name", () => {
    const out = aggregateScreens([s("Zebra", 1), s("Alpha", 1), s("Mid", 1)]);
    expect(out.map((b) => b.screen)).toEqual(["Alpha", "Mid", "Zebra"]);
  });

  it("treats differently-cased screen names as distinct buckets (exact grouping)", () => {
    const out = aggregateScreens([s("Home", 1), s("home", 1)]);
    expect(out).toHaveLength(2);
  });

  it("handles a zero render time without collapsing to a falsy bucket", () => {
    const out = aggregateScreens([s("Splash", 0)]);
    expect(out[0]).toMatchObject({ screen: "Splash", renderP50Ms: 0, renderMaxMs: 0, observations: 1 });
  });
});
