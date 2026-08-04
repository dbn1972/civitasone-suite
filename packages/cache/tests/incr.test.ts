/**
 * `Cache.incr` — the atomic counter primitive rate limiters depend on.
 *
 * These tests exist because the pattern they replace (`getOrLoad` → compare →
 * `put(used + 1)`) looked correct and was not: `getOrLoad` coalesces concurrent cold-key
 * callers onto ONE shared promise, so every racing caller saw the same pre-increment
 * value. The concurrency test below is the one that matters.
 */
import { describe, it, expect } from "vitest";
import { Cache, MemoryCache } from "../src/index.js";

function freshCache(): Cache {
  return new Cache({ service: "test", store: new MemoryCache(), defaultTtlSeconds: 60 });
}

describe("Cache.incr", () => {
  it("returns the count AFTER the increment, starting at 1", async () => {
    const cache = freshCache();
    expect(await cache.incr("test:t:rl:a", 60)).toBe(1);
    expect(await cache.incr("test:t:rl:a", 60)).toBe(2);
    expect(await cache.incr("test:t:rl:a", 60)).toBe(3);
  });

  it("keeps distinct keys on distinct counters", async () => {
    const cache = freshCache();
    await cache.incr("test:t:rl:a", 60);
    await cache.incr("test:t:rl:a", 60);
    expect(await cache.incr("test:t:rl:b", 60)).toBe(1);
  });

  it("hands every CONCURRENT caller a distinct value — no coalescing, no lost updates", async () => {
    const cache = freshCache();
    // The failing shape of the old limiter: N callers hitting one cold key at once.
    const results = await Promise.all(
      Array.from({ length: 25 }, () => cache.incr("test:t:rl:burst", 60)),
    );
    expect([...results].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });

  it("only N of N+M concurrent callers can be under a limit of N", async () => {
    const cache = freshCache();
    const LIMIT = 2;
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, async () => (await cache.incr("test:t:rl:gate", 60)) <= LIMIT),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(LIMIT);
  });

  it("expires the counter, and does not extend the window on later increments", async () => {
    const cache = freshCache();
    // 1s is the store's minimum TTL. The counter must die on its own schedule, measured
    // from creation — a limiter whose window slides forward under load never resets, so a
    // form could be locked out permanently.
    expect(await cache.incr("test:t:rl:ttl", 1)).toBe(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(await cache.incr("test:t:rl:ttl", 1)).toBe(2);
    await new Promise((r) => setTimeout(r, 1_050));
    expect(await cache.incr("test:t:rl:ttl", 1)).toBe(1);
  });

  it("is cleared by invalidateResource along with cached values", async () => {
    const cache = freshCache();
    const key = cache.makeKey("public", "rl", "x");
    await cache.incr(key, 60);
    await cache.incr(key, 60);
    await cache.invalidateResource("public", "rl");
    expect(await cache.incr(key, 60)).toBe(1);
  });

  it("does not collide with a cached value stored under the same key", async () => {
    // Counters and serialised entries live in separate maps in MemoryCache; a counter is
    // an integer in the store, not a JSON-serialised entity.
    const cache = freshCache();
    await cache.put("test:t:rl:mix", { some: "entity" }, 60);
    expect(await cache.incr("test:t:rl:mix", 60)).toBe(1);
    expect(await cache.getOrLoad("test:t:rl:mix", async () => null)).toEqual({ some: "entity" });
  });
});
