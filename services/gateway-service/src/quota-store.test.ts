/**
 * Redis quota counter must never be left without a TTL (CLOS3-S5-11): INCR then a separate
 * EXPIRE-on-first-hit leaves a permanent counter if EXPIRE fails or the process dies in between.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const state = {
    now: 0,
    vals: new Map<string, number>(),
    exp: new Map<string, number>(), // absolute ms expiry
    expireFailures: 0,
  };
  const live = (k: string) => {
    const e = state.exp.get(k);
    if (e !== undefined && e <= state.now) { state.vals.delete(k); state.exp.delete(k); }
  };
  class FakeRedis {
    async connect() {}
    async get() { return null; }
    async set() { return "OK"; }
    async incr(k: string) { live(k); const v = (state.vals.get(k) ?? 0) + 1; state.vals.set(k, v); return v; }
    async expire(k: string, s: number) {
      if (state.expireFailures > 0) { state.expireFailures--; throw new Error("expire failed"); }
      state.exp.set(k, state.now + s * 1000); return 1;
    }
    async ttl(k: string) { live(k); if (!state.vals.has(k)) return -2; const e = state.exp.get(k); return e === undefined ? -1 : Math.ceil((e - state.now) / 1000); }
    /** Atomic emulation of: INCR; if v==1 or TTL<0 then EXPIRE; return v. */
    async eval(_script: string, _n: number, key: string, ttl: number | string) {
      const v = await this.incr(key);
      if (v === 1 || (await this.ttl(key)) < 0) state.exp.set(key, state.now + Number(ttl) * 1000);
      return v;
    }
  }
  return { state, FakeRedis };
});

vi.mock("ioredis", () => ({ default: fake.FakeRedis }));

import { createRedisQuotaStore } from "./quota-store.js";

const KEY = "gw:quota:ctr:k";
const ttlOf = (): number | undefined => {
  const e = fake.state.exp.get(KEY);
  return e === undefined ? undefined : (e - fake.state.now) / 1000;
};

describe("redis quota store incr TTL", () => {
  beforeEach(() => {
    fake.state.now = 1_000_000;
    fake.state.vals.clear();
    fake.state.exp.clear();
    fake.state.expireFailures = 0;
  });

  it("sets the TTL on the first hit and does not extend it on later hits", async () => {
    const store = await createRedisQuotaStore("redis://x");
    expect(await store.incr("k", 60)).toBe(1);
    expect(ttlOf()).toBe(60);
    fake.state.now += 30_000;
    expect(await store.incr("k", 60)).toBe(2);
    expect(ttlOf()).toBe(30);
  });

  it("a failed EXPIRE on the first hit never leaves the counter without a TTL", async () => {
    const store = await createRedisQuotaStore("redis://x");
    fake.state.expireFailures = 1;
    await store.incr("k", 60).catch(() => undefined);
    await store.incr("k", 60).catch(() => undefined);
    expect(fake.state.vals.get(KEY)).toBeGreaterThan(0);
    expect(ttlOf()).toBeGreaterThan(0);
  });

  it("the counter resets once the window passes", async () => {
    const store = await createRedisQuotaStore("redis://x");
    fake.state.expireFailures = 1;
    await store.incr("k", 60).catch(() => undefined);
    await store.incr("k", 60).catch(() => undefined);
    fake.state.now += 61_000;
    expect(await store.incr("k", 60)).toBe(1);
  });
});
