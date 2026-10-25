/**
 * CLOS3-S6-08: RedisCache.incr must initialise the counter AND its TTL atomically.
 *
 * Two non-atomic commands (INCR then EXPIRE-only-if-1) left a counter with NO TTL
 * when the EXPIRE failed or the process died in between; the counter then only grew
 * and callers using it as a rate limiter (password reset, OTP, public capture) were
 * locked out permanently. The fake below models the Redis semantics the fix relies
 * on: `eval` runs the whole script atomically; discrete `expire` can be made to fail.
 */
import { describe, it, expect } from "vitest";
import { RedisCache } from "../src/index.js";

class FakeRedis {
  store = new Map<string, { n: number; ttl: number }>(); // ttl -1 = none
  failExpireOnce = false;
  async incr(key: string) {
    const e = this.store.get(key) ?? { n: 0, ttl: -1 };
    e.n += 1;
    this.store.set(key, e);
    return e.n;
  }
  async expire(key: string, ttl: number) {
    if (this.failExpireOnce) {
      this.failExpireOnce = false;
      throw new Error("Command timed out");
    }
    const e = this.store.get(key);
    if (e) e.ttl = Number(ttl);
    return e ? 1 : 0;
  }
  async ttl(key: string) { return this.store.get(key)?.ttl ?? -2; }
  /** Atomic server-side script: INCR; (re)arm EXPIRE only when new or TTL-less. */
  async eval(script: string, _numKeys: number, key: string, ttl: string | number) {
    if (!/INCR/.test(script) || !/EXPIRE/.test(script)) throw new Error("unexpected script");
    const e = this.store.get(key) ?? { n: 0, ttl: -1 };
    e.n += 1;
    if (e.n === 1 || e.ttl === -1) e.ttl = Number(ttl);
    this.store.set(key, e);
    return e.n;
  }
}

const mk = () => {
  const redis = new FakeRedis();
  return { redis, cache: new RedisCache(redis as never) };
};

describe("RedisCache.incr — atomic counter + TTL", () => {
  it("sets a TTL on the first increment and returns the count", async () => {
    const { redis, cache } = mk();
    expect(await cache.incr("k", 60)).toBe(1);
    expect(redis.store.get("k")!.ttl).toBe(60);
    expect(await cache.incr("k", 60)).toBe(2);
  });

  it("an EXPIRE failure cannot strand a TTL-less counter", async () => {
    const { redis, cache } = mk();
    redis.failExpireOnce = true;
    await cache.incr("k", 60).catch(() => undefined);
    expect(redis.store.get("k")?.ttl).toBe(60);
    expect(await cache.incr("k", 60)).toBe(2);
    expect(redis.store.get("k")!.ttl).toBe(60);
  });

  it("self-heals an existing key that has no TTL", async () => {
    const { redis, cache } = mk();
    redis.store.set("k", { n: 5, ttl: -1 });
    expect(await cache.incr("k", 60)).toBe(6);
    expect(redis.store.get("k")!.ttl).toBe(60);
  });

  it("does not slide the window of a key that already has a TTL", async () => {
    const { redis, cache } = mk();
    redis.store.set("k", { n: 3, ttl: 17 });
    expect(await cache.incr("k", 60)).toBe(4);
    expect(redis.store.get("k")!.ttl).toBe(17);
  });

  it("parallel callers receive distinct values", async () => {
    const { cache } = mk();
    const r = await Promise.all(Array.from({ length: 20 }, () => cache.incr("k", 60)));
    expect([...r].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
