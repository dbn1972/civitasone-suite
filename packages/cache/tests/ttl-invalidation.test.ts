import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Cache,
  MemoryCache,
  clampTtl,
  DEFAULT_TTL_SECONDS,
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
} from "../src/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// 04-T5 cache-invalidation consistency
//
// Finding: the 31 service consumers invalidate the read cache AFTER the DB tx
// commits but OUTSIDE the transaction, so a crash in the window
// [commit succeeded -> invalidate not yet sent] leaves a stale entry until TTL.
//
// Remediation (BOTH):
//   1. Every entry has a BOUNDED TTL (clamped to [MIN, MAX]) so a missed
//      invalidation self-heals within at most MAX_TTL_SECONDS.
//   2. getOrLoad repopulates from source on a miss (write-through-on-read), and
//      invalidateAfterCommit expresses the correct "invalidate on commit"
//      pattern (uses a commit hook when available, else immediate + TTL backstop).
//
// These tests prove the TTL self-healing guarantee and getOrLoad repopulation.
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("clampTtl bounds", () => {
  it("clamps non-positive, NaN, and Infinity into the supported band", () => {
    expect(clampTtl(0)).toBe(MIN_TTL_SECONDS);
    expect(clampTtl(-10)).toBe(MIN_TTL_SECONDS);
    expect(clampTtl(Number.NaN)).toBe(MAX_TTL_SECONDS);
    expect(clampTtl(Number.POSITIVE_INFINITY)).toBe(MAX_TTL_SECONDS);
    expect(clampTtl(MAX_TTL_SECONDS + 9_999_999)).toBe(MAX_TTL_SECONDS);
    expect(clampTtl(60)).toBe(60);
  });
});

describe("default TTL is bounded and self-heals", () => {
  it("expires an entry written WITHOUT an explicit TTL by the default TTL", async () => {
    const cache = new Cache({ service: "test", defaultTtlSeconds: 5, store: new MemoryCache() });
    const key = cache.makeKey("tenant-a", "widget", "1");

    // put() with no ttl => uses the bounded default TTL (5s here).
    await cache.put(key, { v: 1 });
    expect(cache.defaultTtlSeconds).toBe(5);

    // Within the TTL the value is served from cache and the loader is NOT called.
    let loaderCalls = 0;
    const loader = async () => {
      loaderCalls++;
      return { v: 2 };
    };
    expect(await cache.getOrLoad(key, loader)).toEqual({ v: 1 });
    expect(loaderCalls).toBe(0);

    // After the default TTL elapses the entry is gone (self-heal).
    vi.advanceTimersByTime(5_001);
    expect(await cache.getOrLoad(key, loader)).toEqual({ v: 2 });
    expect(loaderCalls).toBe(1); // getOrLoad repopulated from source on miss

    // It is now cached again, so a subsequent read does not hit the loader.
    expect(await cache.getOrLoad(key, async () => ({ v: 3 }))).toEqual({ v: 2 });
  });

  it("falls back to the package default TTL when none is configured", () => {
    const cache = new Cache({ service: "test", store: new MemoryCache() });
    expect(cache.defaultTtlSeconds).toBe(DEFAULT_TTL_SECONDS);
  });

  it("caps an unbounded configured default TTL at MAX_TTL_SECONDS", async () => {
    const cache = new Cache({
      service: "test",
      defaultTtlSeconds: 10_000_000, // attempt to (effectively) cache forever
      store: new MemoryCache(),
    });
    expect(cache.defaultTtlSeconds).toBe(MAX_TTL_SECONDS);

    const key = cache.makeKey("tenant-a", "widget", "2");
    await cache.put(key, { v: 1 });

    // Just past the hard cap, the entry must be gone — no entry lives forever.
    vi.advanceTimersByTime(MAX_TTL_SECONDS * 1000 + 1);
    expect(await cache.getOrLoad(key, async () => null)).toBeNull();
  });

  it("caps an unbounded explicit ttl passed to put()", async () => {
    const cache = new Cache({ service: "test", defaultTtlSeconds: 5, store: new MemoryCache() });
    const key = cache.makeKey("tenant-a", "widget", "3");

    await cache.put(key, { v: 1 }, Number.POSITIVE_INFINITY);
    vi.advanceTimersByTime(MAX_TTL_SECONDS * 1000 + 1);
    expect(await cache.getOrLoad(key, async () => null)).toBeNull();
  });
});

describe("invalidateAfterCommit", () => {
  it("registers the invalidation on the commit hook when the tx supports one", async () => {
    const cache = new Cache({ service: "test", defaultTtlSeconds: 60, store: new MemoryCache() });
    const key = cache.makeKey("tenant-a", "widget", "4");
    await cache.put(key, { v: 1 });

    const hooks: Array<() => void | Promise<void>> = [];
    const tx = { onCommit: (fn: () => void | Promise<void>) => hooks.push(fn) };

    await cache.invalidateAfterCommit(tx, key);
    // Not invalidated yet — it only runs on commit.
    expect(await cache.getOrLoad(key, async () => null)).toEqual({ v: 1 });

    // Simulate commit.
    for (const h of hooks) await h();
    expect(await cache.getOrLoad(key, async () => null)).toBeNull();
  });

  it("invalidates immediately when the tx has no commit hook (TTL is the backstop)", async () => {
    const cache = new Cache({ service: "test", defaultTtlSeconds: 60, store: new MemoryCache() });
    const key = cache.makeKey("tenant-a", "widget", "5");
    await cache.put(key, { v: 1 });

    await cache.invalidateAfterCommit({}, key);
    expect(await cache.getOrLoad(key, async () => null)).toBeNull();
  });
});
