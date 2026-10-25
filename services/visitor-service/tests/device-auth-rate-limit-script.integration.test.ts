/**
 * CLOS3-S6-09 (review round 1): run the REAL Lua script against a real Redis.
 * The earlier unit test faked eval() and ignored the script text, so an
 * invalid script (unquoted command names) passed while every production call
 * errored and silently fell back to the in-memory limiter.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import {
  RATE_LIMIT_INCR_SCRIPT,
  checkRateLimit,
  resetDeviceAuthForTests,
  setRateLimitRedisForTests,
} from "../src/modules/device-registry/device-auth.js";

const url = process.env.REDIS_URL ?? "redis://localhost:6381";
const tenant = randomUUID();
const device = randomUUID();
const key = `visitor:${tenant}:device:${device}:rate`;
let redis: Redis;

beforeAll(async () => {
  redis = new Redis(url);
  await redis.ping();
});

afterAll(async () => {
  setRateLimitRedisForTests(null);
  await redis.del(key, `${key}:orphan`);
  redis.disconnect();
});

describe("device rate limit: real Lua script on real Redis (CLOS3-S6-09)", () => {
  it("script compiles and runs: INCR returns 1, then 2, and arms a TTL", async () => {
    const k = `${key}:script`;
    try {
      expect(Number(await redis.eval(RATE_LIMIT_INCR_SCRIPT, 1, k, 60))).toBe(1);
      expect(Number(await redis.eval(RATE_LIMIT_INCR_SCRIPT, 1, k, 60))).toBe(2);
      const ttl = await redis.ttl(k);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    } finally {
      await redis.del(k);
    }
  });

  it("re-arms the TTL on a key orphaned without one", async () => {
    const k = `${key}:orphan`;
    await redis.set(k, "5");
    expect(await redis.ttl(k)).toBe(-1);
    expect(Number(await redis.eval(RATE_LIMIT_INCR_SCRIPT, 1, k, 60))).toBe(6);
    expect(await redis.ttl(k)).toBeGreaterThan(0);
  });

  it("checkRateLimit goes through Redis (key exists with TTL) and enforces the limit", async () => {
    resetDeviceAuthForTests();
    setRateLimitRedisForTests(redis);
    for (let i = 0; i < 60; i++) expect(await checkRateLimit(device, tenant, "kiosk")).toBe(true);
    expect(await checkRateLimit(device, tenant, "kiosk")).toBe(false);
    // Proves the Redis path was used, not the silent in-memory fallback.
    expect(Number(await redis.get(key))).toBe(61);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
  });
});
