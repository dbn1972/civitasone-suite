/**
 * CLOS3-S6-09: the per-device rate-limit key must always carry a TTL.
 *
 * Old code did `INCR` then `EXPIRE` (only when count===1) as two round trips.
 * If that single EXPIRE failed, the key lived forever and, once over the
 * limit, the device was blocked permanently. The fix is one atomic EVAL.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetDeviceAuthForTests, setRateLimitRedisForTests } from "../src/modules/device-registry/device-auth.js";

/** Minimal in-memory Redis emulating the commands (and the Lua script) used. */
class FakeRedis {
  store = new Map<string, number>();
  ttl = new Map<string, number>(); // seconds; absent => no expiry
  failNextExpire = false;
  disconnect() {}
  async incr(k: string) {
    const v = (this.store.get(k) ?? 0) + 1;
    this.store.set(k, v);
    return v;
  }
  async expire(k: string, s: number) {
    if (this.failNextExpire) {
      this.failNextExpire = false;
      throw new Error("expire failed");
    }
    this.ttl.set(k, s);
    return 1;
  }
  // Emulates the atomic script: INCR; if c==1 or no TTL then EXPIRE; return c.
  async eval(_script: string, _n: number, key: string, window: number) {
    const c = await this.incr(key);
    if (c === 1 || !this.ttl.has(key)) this.ttl.set(key, Number(window));
    return c;
  }
  /** Simulates the window elapsing: keys with a TTL vanish. */
  elapseWindow() {
    for (const k of [...this.ttl.keys()]) {
      this.ttl.delete(k);
      this.store.delete(k);
    }
  }
}

const KEY = "visitor:t1:device:d1:rate";

describe("device rate limit: atomic INCR+EXPIRE (CLOS3-S6-09)", () => {
  let redis: FakeRedis;
  beforeEach(() => {
    resetDeviceAuthForTests();
    redis = new FakeRedis();
    setRateLimitRedisForTests(redis as never);
  });

  it("key always gets a TTL even when a standalone EXPIRE would fail once", async () => {
    redis.failNextExpire = true;
    await checkRateLimit("d1", "t1", "kiosk").catch(() => undefined);
    await checkRateLimit("d1", "t1", "kiosk");
    expect(redis.ttl.get(KEY)).toBe(60);
  });

  it("a device past the limit is allowed again after the window elapses", async () => {
    redis.failNextExpire = true;
    await checkRateLimit("d1", "t1", "kiosk").catch(() => undefined);
    for (let i = 0; i < 70; i++) await checkRateLimit("d1", "t1", "kiosk");
    expect(await checkRateLimit("d1", "t1", "kiosk")).toBe(false);
    redis.elapseWindow();
    expect(await checkRateLimit("d1", "t1", "kiosk")).toBe(true);
  });

  it("requests within the limit are allowed; the request past it is rejected", async () => {
    for (let i = 0; i < 60; i++) expect(await checkRateLimit("d1", "t1", "kiosk")).toBe(true);
    expect(await checkRateLimit("d1", "t1", "kiosk")).toBe(false);
  });

  it("turnstiles keep their higher limit (120)", async () => {
    for (let i = 0; i < 120; i++) expect(await checkRateLimit("d1", "t1", "turnstile")).toBe(true);
    expect(await checkRateLimit("d1", "t1", "turnstile")).toBe(false);
  });
});
