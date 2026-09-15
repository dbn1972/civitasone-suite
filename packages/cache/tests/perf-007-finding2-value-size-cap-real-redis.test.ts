import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Redis } from "ioredis";
import { Cache, RedisCache, MAX_CACHE_VALUE_BYTES } from "../src/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// PERF-007, Finding 2 — unbounded cache-value size
//
// serialize()/put()/getOrLoad()/listOrLoad()/getOrLoadWithNegative() had no
// size check at all before writing a value to the store: a caller (or its
// loader) that returns a large/unpaginated result caches that entire
// JSON-serialised blob in shared Redis memory with no bound, unlike TTL
// (already clamped) or tenant scoping (already enforced by makeKey). The fix
// adds a single choke point (`Cache.writeToStore`) that skips the real store
// write when the serialised value exceeds MAX_CACHE_VALUE_BYTES, logging a
// warning, while still returning the correct fresh value to the caller.
//
// Verified against a REAL Redis instance (not MemoryCache) because the thing
// being proven is "no network write happens", which only means something
// against an actual store.
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6381";
const rawRedis = new Redis(REDIS_URL);
const testKeys: string[] = [];

beforeAll(async () => {
  await rawRedis.ping();
});

afterEach(async () => {
  if (testKeys.length) {
    await rawRedis.del(...testKeys);
    testKeys.length = 0;
  }
});

afterAll(async () => {
  rawRedis.disconnect();
});

function track(key: string): string {
  testKeys.push(key);
  return key;
}

describe("Finding 2 (PERF-007): unbounded cache-value size", () => {
  it("does NOT write an oversized value to real Redis, but still returns it to the caller", async () => {
    const store = new RedisCache(rawRedis);
    const cache = new Cache({ service: "perf007", store });
    const key = track(cache.makeKey("tenant-perf007-c", "bigreport", "1"));

    // Comfortably over MAX_CACHE_VALUE_BYTES once JSON-serialised.
    const oversized = { blob: "x".repeat(MAX_CACHE_VALUE_BYTES + 1024) };

    const loaderResult = await cache.getOrLoad(key, async () => oversized);

    // The caller still gets the correct value back...
    expect(loaderResult).toEqual(oversized);
    // ...but nothing was ever written to real Redis for it.
    expect(await rawRedis.get(key)).toBeNull();

    // put() is the same choke point -- same guarantee.
    await cache.put(key, oversized);
    expect(await rawRedis.get(key)).toBeNull();
  });

  it("still writes a normal-sized value to real Redis (the cap doesn't break ordinary caching)", async () => {
    const store = new RedisCache(rawRedis);
    const cache = new Cache({ service: "perf007", store });
    const key = track(cache.makeKey("tenant-perf007-d", "widget", "1"));

    await cache.put(key, { v: "small value" });

    const raw = await rawRedis.get(key);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ v: "small value" });

    // getOrLoad reads it back from real Redis without re-invoking the loader.
    let loaderCalls = 0;
    const result = await cache.getOrLoad(key, async () => {
      loaderCalls++;
      return { v: "should not be reached" };
    });
    expect(result).toEqual({ v: "small value" });
    expect(loaderCalls).toBe(0);
  });

  it("a value exactly at the cap is written; one byte over is not (boundary check)", async () => {
    const store = new RedisCache(rawRedis);
    const cache = new Cache({ service: "perf007", store });

    // Reserve room for the JSON string-quoting overhead ("..") when picking
    // padding lengths so the two payloads land on either side of the byte cap.
    const atCapKey = track(cache.makeKey("tenant-perf007-f", "boundary", "at-cap"));
    const atCapValue = "x".repeat(MAX_CACHE_VALUE_BYTES - 2); // JSON.stringify wraps in quotes: exactly MAX_CACHE_VALUE_BYTES bytes
    await cache.put(atCapKey, atCapValue);
    expect(await rawRedis.get(atCapKey)).not.toBeNull();

    const overCapKey = track(cache.makeKey("tenant-perf007-f", "boundary", "over-cap"));
    const overCapValue = "x".repeat(MAX_CACHE_VALUE_BYTES - 1); // one byte over once quoted
    await cache.put(overCapKey, overCapValue);
    expect(await rawRedis.get(overCapKey)).toBeNull();
  });
});
