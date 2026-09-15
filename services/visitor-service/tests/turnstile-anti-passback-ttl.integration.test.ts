/**
 * PERF-007 (visitor-service) — anti-passback Redis key had no TTL.
 *
 * turnstile-control/consumer.ts#setAntiPassbackState wrote
 * `visitor:{tenantId}:pass:{passId}:direction` via a plain `redis.set(key,
 * direction)` with no expiry at all. Every pass that ever traverses a
 * turnstile leaves a key that lives in Redis forever unless an operator
 * explicitly calls the admin reset endpoint
 * (POST /v1/visitor/turnstiles/anti-passback/reset) — unlike every entry
 * `packages/cache` manages, which is hard-capped at MAX_TTL_SECONDS for
 * exactly this "cached data that never expires" reason.
 *
 * Fix: setAntiPassbackState now writes with `EX ANTI_PASSBACK_TTL_SECONDS`
 * (24h) — long enough that no legitimate same-day anti-passback check is
 * affected (state is re-set on every real passage anyway), while bounding
 * unbounded key growth for passes that are never explicitly reset.
 *
 * Verified against a real Redis instance (not MemoryCache/in-process Map):
 * TTL is a real Redis server-side concept the in-memory fallback doesn't
 * model at all, so only a real Redis TTL check proves this fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

// getRedis() in turnstile-control/consumer.ts reads these lazily, at call
// time (same pattern as tests/document-scan-blacklist-screening-mismatch.
// integration.test.ts) -- setting them here, before any test body runs, is
// sufficient even though the imports below are static.
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6381";
process.env.CACHE_DRIVER = "redis";

import { setAntiPassbackState, getAntiPassbackState } from "../src/modules/turnstile-control/consumer.js";
import { clearAntiPassbackState } from "../src/modules/turnstile-control/repo.js";

function antiPassbackKey(tenantId: string, passId: string): string {
  return `visitor:${tenantId}:pass:${passId}:direction`;
}

const TENANT = randomUUID();
const PASS_ID = randomUUID();

let rawRedis: Redis;

beforeAll(async () => {
  rawRedis = new Redis(process.env.REDIS_URL!);
  await rawRedis.ping();
});

afterAll(async () => {
  await clearAntiPassbackState(TENANT, PASS_ID);
  rawRedis.disconnect();
});

describe("Finding 3 (PERF-007): anti-passback state now carries a bounded TTL", () => {
  it("writes the direction key with a positive, bounded TTL on real Redis instead of living forever", async () => {
    await setAntiPassbackState(TENANT, PASS_ID, "in");

    const key = antiPassbackKey(TENANT, PASS_ID);
    const ttl = await rawRedis.ttl(key);

    // Real Redis TTL semantics: -1 = key exists but never expires (the bug),
    // -2 = key doesn't exist. A real, bounded TTL is a positive integer.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);

    // The value itself is unaffected by adding a TTL -- still read back correctly.
    expect(await getAntiPassbackState(TENANT, PASS_ID)).toBe("in");
  });

  it("a later passage overwrites the direction AND refreshes the TTL (no permanently-stuck expiry)", async () => {
    await setAntiPassbackState(TENANT, PASS_ID, "out");
    const key = antiPassbackKey(TENANT, PASS_ID);

    expect(await getAntiPassbackState(TENANT, PASS_ID)).toBe("out");
    expect(await rawRedis.ttl(key)).toBeGreaterThan(0);
  });
});
