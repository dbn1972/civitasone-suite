import { describe, it, expect } from "vitest";
import { MemoryCache } from "../src/index.js";
import { withIdempotency, canonicalJson, IdempotencyKeyReusedError, IdempotencyInProgressError } from "../src/idempotency.js";

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
