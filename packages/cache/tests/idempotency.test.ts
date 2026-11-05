import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MemoryCache } from "../src/index.js";
import { withIdempotency, canonicalJson, idempotencyStoreFailures, IdempotencyKeyReusedError, IdempotencyInProgressError } from "../src/idempotency.js";

const base = { scope: "test.create", tenantId: "t1", actorId: "u1" };

describe("withIdempotency (TE-09)", () => {
  it("no key: runs every time", async () => {
    const store = new MemoryCache();
    let runs = 0;
    await withIdempotency(store, { ...base, key: undefined, body: { a: 1 } }, async () => ++runs);
    await withIdempotency(store, { ...base, key: "", body: { a: 1 } }, async () => ++runs);
    expect(runs).toBe(2);
  });

  it("same key + same body: runs once and replays the original response", async () => {
    const store = new MemoryCache();
    let runs = 0;
    const first = await withIdempotency(store, { ...base, key: "k1", body: { a: 1, b: [1, 2] } }, async () => ({ id: `id-${++runs}` }));
    const second = await withIdempotency(store, { ...base, key: "k1", body: { b: [1, 2], a: 1 } }, async () => ({ id: `id-${++runs}` }));
    expect(runs).toBe(1);
    expect(first).toEqual({ value: { id: "id-1" }, replayed: false });
    expect(second).toEqual({ value: { id: "id-1" }, replayed: true });
  });

  it("same key + different body: 422 IDEMPOTENCY_KEY_REUSED", async () => {
    const store = new MemoryCache();
    await withIdempotency(store, { ...base, key: "k2", body: { a: 1 } }, async () => "ok");
    const err = await withIdempotency(store, { ...base, key: "k2", body: { a: 2 } }, async () => "other").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IdempotencyKeyReusedError);
    expect((err as IdempotencyKeyReusedError).status).toBe(422);
    expect((err as IdempotencyKeyReusedError).code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("two parallel requests with the same key run once; both get the same answer", async () => {
    const store = new MemoryCache();
    let runs = 0;
    const run = async () => { runs++; await new Promise((r) => setTimeout(r, 80)); return { id: "only" }; };
    const [a, b] = await Promise.all([
      withIdempotency(store, { ...base, key: "k3", body: { x: 1 }, pollMs: 5 }, run),
      withIdempotency(store, { ...base, key: "k3", body: { x: 1 }, pollMs: 5 }, run),
    ]);
    expect(runs).toBe(1);
    expect(a.value).toEqual({ id: "only" });
    expect(b.value).toEqual({ id: "only" });
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
  });

  it("a parallel request with the same key but another body is refused", async () => {
    const store = new MemoryCache();
    const slow = async () => { await new Promise((r) => setTimeout(r, 80)); return "first"; };
    const [a, b] = await Promise.allSettled([
      withIdempotency(store, { ...base, key: "k4", body: { x: 1 }, pollMs: 5 }, slow),
      withIdempotency(store, { ...base, key: "k4", body: { x: 2 }, pollMs: 5 }, slow),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("rejected");
    expect((b as PromiseRejectedResult).reason).toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("still running after the wait: 409 IDEMPOTENCY_IN_PROGRESS (retryable)", async () => {
    const store = new MemoryCache();
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    const first = withIdempotency(store, { ...base, key: "k5", body: {} }, async () => { await blocked; return 1; });
    await new Promise((r) => setTimeout(r, 5));
    const err = await withIdempotency(store, { ...base, key: "k5", body: {}, waitMs: 30, pollMs: 5 }, async () => 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IdempotencyInProgressError);
    expect((err as IdempotencyInProgressError).retryable).toBe(true);
    release();
    await first;
  });

  it("a failed first attempt releases the key for a corrected retry", async () => {
    const store = new MemoryCache();
    await expect(withIdempotency(store, { ...base, key: "k6", body: { a: 1 } }, async () => { throw new Error("422 refused"); })).rejects.toThrow("422 refused");
    const retry = await withIdempotency(store, { ...base, key: "k6", body: { a: 2 } }, async () => "fixed");
    expect(retry).toEqual({ value: "fixed", replayed: false });
  });

  it("keys are private per tenant, actor and scope", async () => {
    const store = new MemoryCache();
    let runs = 0;
    const run = async () => ++runs;
    await withIdempotency(store, { ...base, key: "k7", body: {} }, run);
    await withIdempotency(store, { ...base, actorId: "u2", key: "k7", body: {} }, run);
    await withIdempotency(store, { ...base, tenantId: "t2", key: "k7", body: {} }, run);
    await withIdempotency(store, { ...base, scope: "other", key: "k7", body: {} }, run);
    expect(runs).toBe(4);
  });

  it("canonicalJson sorts keys and handles bigint", () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: [3] } })).toBe("{\"a\":{\"c\":[3],\"d\":\"2\"},\"b\":1}");
  });
});

describe("withIdempotency failure modes (PR #2465 blocker 2)", () => {
  /** A store whose operations all reject, like Redis being down. */
  class DownStore extends MemoryCache {
    async get(): Promise<string | null> { throw new Error("redis down"); }
    async set(): Promise<void> { throw new Error("redis down"); }
    async del(): Promise<void> { throw new Error("redis down"); }
    async incr(): Promise<number> { throw new Error("redis down"); }
  }

  it("fails OPEN when the store is down: the command runs once, no 500", async () => {
    const seen: unknown[] = [];
    let runs = 0;
    const before = idempotencyStoreFailures();
    const r = await withIdempotency(new DownStore(), { ...base, key: "d1", body: { a: 1 }, onStoreError: (e) => seen.push(e) }, async () => ({ id: ++runs }));
    expect(r).toEqual({ value: { id: 1 }, replayed: false });
    expect(runs).toBe(1);
    expect(seen).toHaveLength(1);
    expect(idempotencyStoreFailures()).toBe(before + 1);
  });

  it("a command error with the store down is the command's own error, and it is not run twice", async () => {
    let runs = 0;
    await expect(withIdempotency(new DownStore(), { ...base, key: "d2", body: {}, onStoreError: () => undefined }, async () => { runs++; throw new Error("422 refused"); })).rejects.toThrow("422 refused");
    expect(runs).toBe(1);
  });

  it("if storing the answer fails after the command ran, the caller still gets the value (not a 500) and the key is released", async () => {
    class RespFails extends MemoryCache {
      async set(key: string, value: string, ttl: number): Promise<void> {
        if (key.endsWith(":resp")) throw new Error("redis went away");
        return super.set(key, value, ttl);
      }
    }
    const store = new RespFails();
    let runs = 0;
    const first = await withIdempotency(store, { ...base, key: "d3", body: { a: 1 }, onStoreError: () => undefined }, async () => ({ id: ++runs }));
    expect(first).toEqual({ value: { id: 1 }, replayed: false });
    // Not wedged: the retry is not a 409 IDEMPOTENCY_IN_PROGRESS; it runs again (consumer dedupe drops the duplicate).
    const retry = await withIdempotency(store, { ...base, key: "d3", body: { a: 1 }, waitMs: 30, pollMs: 5, onStoreError: () => undefined }, async () => ({ id: ++runs }));
    expect(retry.value).toEqual({ id: 2 });
  });

  it("the in-flight claim has a short TTL: a crashed owner does not wedge the key for 24h", async () => {
    const store = new MemoryCache();
    const ttls = new Map<string, number>();
    const origSet = store.set.bind(store);
    store.set = async (k: string, v: string, t: number) => { ttls.set(k, t); return origSet(k, v, t); };
    const origIncr = store.incr.bind(store);
    store.incr = async (k: string, t: number) => { ttls.set(k, t); return origIncr(k, t); };
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    const pending = withIdempotency(store, { ...base, key: "w1", body: {} }, async () => { await blocked; return 1; });
    await new Promise((r) => setTimeout(r, 5));
    const claim = [...ttls.entries()].find(([k]) => k.endsWith(":claim"))!;
    const lease = [...ttls.entries()].find(([k]) => k.endsWith(":hash"))!;
    expect(claim[1]).toBeLessThanOrEqual(120);
    expect(lease[1]).toBeLessThanOrEqual(120);
    release();
    await pending;
    // After completion the answer and hash live for the long TTL.
    expect(ttls.get([...ttls.keys()].find((k) => k.endsWith(":resp"))!)).toBe(24 * 3600);
  });

  it("owner died mid-run (claim + lease never renewed, then expired): the next request takes the key over", async () => {
    const store = new MemoryCache();
    const k = `idem:test.create:t1:u1:${createHash("sha256").update("w2").digest("hex")}`;
    // What a crashed process leaves behind: a short claim and lease, no answer.
    await store.incr(`${k}:claim`, 1);
    await store.set(`${k}:hash`, createHash("sha256").update(canonicalJson({ a: 1 })).digest("hex"), 1);
    // While the lease is live the key is in progress...
    const during = await withIdempotency(store, { ...base, key: "w2", body: { a: 1 }, waitMs: 20, pollMs: 5 }, async () => "x").catch((e: unknown) => e);
    expect(during).toBeInstanceOf(IdempotencyInProgressError);
    await new Promise((r) => setTimeout(r, 1100));
    // ...and once it lapses (seconds, not 24h) the next request runs.
    const next = await withIdempotency(store, { ...base, key: "w2", body: { a: 1 }, waitMs: 200, pollMs: 10 }, async () => ({ id: 1 }));
    expect(next).toEqual({ value: { id: 1 }, replayed: false });
  });
});
