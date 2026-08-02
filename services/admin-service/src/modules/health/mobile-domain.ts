/**
 * CR-MOB-01 — pure domain logic for mobile performance telemetry.
 *
 * Two jobs, both deterministic and I/O-free:
 *   1. BOUNDS. This data comes from untrusted mobile clients. Every numeric
 *      field has a hard, documented ceiling and an absurd value is REJECTED
 *      rather than stored, clamped or averaged in. The limits live here as
 *      named constants so the route schema, the DB CHECK constraints and the
 *      tests all cite the same source.
 *   2. AGGREGATION. Percentiles and rates over a batch of events.
 */
import { HttpError } from "../../shared/context.js";

export const PLATFORMS = ["ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Bounds, with the reasoning:
 *   coldStartMs 120_000 — 2 minutes. Anything slower is a hung launch, not a
 *                         measurement; the OS would have killed the app.
 *   renderMs     60_000 — 1 minute to paint a screen is not a render time.
 *   crash/anr    10_000 — per reporting batch. Higher means a broken counter.
 *   sessions    100_000 — per reporting batch.
 *   screens         50  — screens reported in one batch.
 */
export const BOUNDS = {
  coldStartMsMax: 120_000,
  warmStartMsMax: 120_000,
  renderMsMax: 60_000,
  crashCountMax: 10_000,
  anrCountMax: 10_000,
  sessionCountMin: 1,
  sessionCountMax: 100_000,
  screensPerBatchMax: 50,
  /** A client clock may run ahead; more than this is rejected as nonsense. */
  futureSkewMs: 5 * 60_000,
  /** Telemetry older than this is stale and refused (bounded retention). */
  maxAgeMs: 7 * 24 * 60 * 60_000,
} as const;

export interface ScreenRenderInput {
  screen: string;
  renderMs: number;
  sampleCount: number;
}

export interface TelemetryInput {
  appVersion: string;
  platform: Platform;
  osVersion: string;
  deviceModel: string;
  coldStartMs: number;
  warmStartMs?: number | undefined;
  crashCount: number;
  anrCount: number;
  sessionCount: number;
  recordedAt: string;
  screens: ScreenRenderInput[];
}

/**
 * Semantic bounds that a zod schema cannot express: the recording timestamp must
 * sit inside a sane window relative to server time. Rejects (422) rather than
 * silently rewriting the client's timestamp, so a broken client is visible.
 */
export function assertRecordedAtInWindow(recordedAt: string, now = new Date()): Date {
  const t = new Date(recordedAt);
  if (Number.isNaN(t.getTime())) {
    throw new HttpError(400, "VALIDATION_FAILED", "recordedAt is not a valid timestamp");
  }
  const delta = t.getTime() - now.getTime();
  if (delta > BOUNDS.futureSkewMs) {
    throw new HttpError(422, "RECORDED_AT_IN_FUTURE", "recordedAt is too far in the future to be a real measurement");
  }
  if (-delta > BOUNDS.maxAgeMs) {
    throw new HttpError(422, "RECORDED_AT_TOO_OLD", "recordedAt is older than the 7-day telemetry retention window");
  }
  return t;
}

/**
 * A crash/ANR count cannot exceed the session count it is reported against —
 * that combination is arithmetically impossible and signals a broken counter.
 */
export function assertCountsConsistent(crashCount: number, anrCount: number, sessionCount: number): void {
  if (crashCount > sessionCount) {
    throw new HttpError(422, "CRASH_EXCEEDS_SESSIONS", "crashCount cannot exceed sessionCount");
  }
  if (anrCount > sessionCount) {
    throw new HttpError(422, "ANR_EXCEEDS_SESSIONS", "anrCount cannot exceed sessionCount");
  }
}

/** Duplicate screen names in one batch would double-count that screen. */
export function assertScreensUnique(screens: readonly ScreenRenderInput[]): void {
  const seen = new Set<string>();
  for (const s of screens) {
    const key = s.screen.toLowerCase();
    if (seen.has(key)) {
      throw new HttpError(422, "DUPLICATE_SCREEN", `screen '${s.screen}' appears more than once in the batch`);
    }
    seen.add(key);
  }
}

// ── aggregation ─────────────────────────────────────────────────────────────

/**
 * Nearest-rank percentile over a numeric sample, 0 <= p <= 100.
 * Empty sample → 0 (an absent measurement is reported as zero, not NaN/null,
 * so a dashboard never has to special-case it).
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((clamped / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

/** Rate per 1000 sessions, rounded to 2 decimals. 0 sessions → 0. */
export function ratePerThousand(count: number, sessions: number): number {
  if (sessions <= 0) return 0;
  return Math.round((count / sessions) * 1000 * 100) / 100;
}

export interface AggregateSample {
  platform: string;
  appVersion: string;
  coldStartMs: number;
  crashCount: number;
  anrCount: number;
  sessionCount: number;
}

export interface AggregateBucket {
  platform: string;
  appVersion: string;
  eventCount: number;
  sessionCount: number;
  coldStartP50Ms: number;
  coldStartP95Ms: number;
  coldStartMaxMs: number;
  crashCount: number;
  anrCount: number;
  crashesPerThousandSessions: number;
  anrsPerThousandSessions: number;
}

/**
 * Group telemetry by (platform, appVersion) and summarise each bucket. Buckets
 * are returned sorted by platform then appVersion for a stable response.
 */
export function aggregateTelemetry(samples: readonly AggregateSample[]): AggregateBucket[] {
  const groups = new Map<string, AggregateSample[]>();
  for (const s of samples) {
    const key = `${s.platform}\u0000${s.appVersion}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const out: AggregateBucket[] = [];
  for (const [, rows] of groups) {
    const first = rows[0];
    if (!first) continue;
    const coldStarts = rows.map((r) => r.coldStartMs);
    const sessions = rows.reduce((n, r) => n + r.sessionCount, 0);
    const crashes = rows.reduce((n, r) => n + r.crashCount, 0);
    const anrs = rows.reduce((n, r) => n + r.anrCount, 0);
    out.push({
      platform: first.platform,
      appVersion: first.appVersion,
      eventCount: rows.length,
      sessionCount: sessions,
      coldStartP50Ms: percentile(coldStarts, 50),
      coldStartP95Ms: percentile(coldStarts, 95),
      coldStartMaxMs: coldStarts.reduce((m, v) => (v > m ? v : m), 0),
      crashCount: crashes,
      anrCount: anrs,
      crashesPerThousandSessions: ratePerThousand(crashes, sessions),
      anrsPerThousandSessions: ratePerThousand(anrs, sessions),
    });
  }
  return out.sort((a, b) =>
    a.platform < b.platform ? -1 : a.platform > b.platform ? 1
      : a.appVersion < b.appVersion ? -1 : a.appVersion > b.appVersion ? 1 : 0);
}

export interface ScreenSample {
  screen: string;
  renderMs: number;
  sampleCount: number;
}

export interface ScreenBucket {
  screen: string;
  observations: number;
  sampleCount: number;
  renderP50Ms: number;
  renderP95Ms: number;
  renderMaxMs: number;
}

/** Group screen render timings by screen name and summarise each. */
export function aggregateScreens(samples: readonly ScreenSample[]): ScreenBucket[] {
  const groups = new Map<string, ScreenSample[]>();
  for (const s of samples) {
    const bucket = groups.get(s.screen);
    if (bucket) bucket.push(s);
    else groups.set(s.screen, [s]);
  }
  const out: ScreenBucket[] = [];
  for (const [screen, rows] of groups) {
    const times = rows.map((r) => r.renderMs);
    out.push({
      screen,
      observations: rows.length,
      sampleCount: rows.reduce((n, r) => n + r.sampleCount, 0),
      renderP50Ms: percentile(times, 50),
      renderP95Ms: percentile(times, 95),
      renderMaxMs: times.reduce((m, v) => (v > m ? v : m), 0),
    });
  }
  return out.sort((a, b) => (a.screen < b.screen ? -1 : a.screen > b.screen ? 1 : 0));
}
