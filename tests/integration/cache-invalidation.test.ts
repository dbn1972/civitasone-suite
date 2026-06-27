/**
 * V-04 — Cache invalidation integration test.
 *
 * Verifies that:
 * 1. A write operation invalidates the read cache for that resource
 * 2. After invalidation, the next read is a cache miss and returns fresh data
 * 3. The stampede protection (_inflight map) prevents duplicate DB calls on cache miss
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Cache, MemoryCache, resetInflightMap } from "../../packages/cache/src/index.js";

let cache: Cache;
let store: MemoryCache;

beforeEach(() => {
  store = new MemoryCache();
  cache = new Cache({ service: "finance", store, defaultTtlSeconds: 60 });
  resetInflightMap();
});

afterEach(() => {
  resetInflightMap();
});

const TENANT = "11111111-aaaa-4000-8000-000000000001";

describe("Cache invalidation after write", () => {
  it("invalidate() removes a single cached entry so next read hits loader", async () => {
    const key = cache.makeKey(TENANT, "bill", "bill-001");

    // Seed the cache with initial data
    let loaderCalls = 0;
    const loader = async () => { loaderCalls++; return { id: "bill-001", amount: 100 }; };

    const first = await cache.getOrLoad(key, loader);
    expect(first).toEqual({ id: "bill-001", amount: 100 });
    expect(loaderCalls).toBe(1);

    // Second read should come from cache (no additional loader call)
    const second = await cache.getOrLoad(key, loader);
    expect(second).toEqual({ id: "bill-001", amount: 100 });
    expect(loaderCalls).toBe(1);

    // Simulate a write operation — invalidate the cache
    await cache.invalidate(key);

    // Next read should miss the cache and call the loader again
    const updatedLoader = async () => { loaderCalls++; return { id: "bill-001", amount: 200 }; };
    const third = await cache.getOrLoad(key, updatedLoader);
    expect(third).toEqual({ id: "bill-001", amount: 200 });
    expect(loaderCalls).toBe(2);
  });

  it("invalidateResource() removes all entries for that resource prefix", async () => {
    const key1 = cache.makeKey(TENANT, "bill", "bill-001");
    const key2 = cache.makeKey(TENANT, "bill", "bill-002");
    const key3 = cache.makeKey(TENANT, "payment", "pay-001");

    await cache.put(key1, { id: "bill-001" });
    await cache.put(key2, { id: "bill-002" });
    await cache.put(key3, { id: "pay-001" });

    // Invalidate all "bill" resources for the tenant
    await cache.invalidateResource(TENANT, "bill");

    // Bill keys should be gone
    let called = false;
    const billLoader = async () => { called = true; return { id: "bill-001", fresh: true }; };
    await cache.getOrLoad(key1, billLoader);
    expect(called).toBe(true);

    // Payment key should still be cached
    let paymentCalled = false;
    const paymentLoader = async () => { paymentCalled = true; return { id: "pay-001", fresh: true }; };
    const payResult = await cache.getOrLoad(key3, paymentLoader);
    expect(paymentCalled).toBe(false);
    expect(payResult).toEqual({ id: "pay-001" });
  });

  it("invalidateAfterCommit performs invalidation immediately (fallback path)", async () => {
    const key = cache.makeKey(TENANT, "bill", "bill-003");
    await cache.put(key, { id: "bill-003", status: "draft" });

    // Fake tx without onCommit hook (the standard drizzle path)
    const fakeTx = {};
    await cache.invalidateAfterCommit(fakeTx, key);

    let loaderCalled = false;
    const loader = async () => { loaderCalled = true; return { id: "bill-003", status: "approved" }; };
    const result = await cache.getOrLoad(key, loader);
    expect(loaderCalled).toBe(true);
    expect(result).toEqual({ id: "bill-003", status: "approved" });
  });
});

describe("Stampede protection (_inflight map)", () => {
  it("concurrent reads for the same cold key only fire the loader once", async () => {
    const key = cache.makeKey(TENANT, "bill", "bill-stampede");
    let loaderCalls = 0;

    // Simulate a slow loader
    const slowLoader = () =>
      new Promise<{ id: string }>((resolve) => {
        loaderCalls++;
        setTimeout(() => resolve({ id: "bill-stampede" }), 50);
      });

    // Fire multiple concurrent requests for the same cold key
    const results = await Promise.all([
      cache.getOrLoad(key, slowLoader),
      cache.getOrLoad(key, slowLoader),
      cache.getOrLoad(key, slowLoader),
      cache.getOrLoad(key, slowLoader),
      cache.getOrLoad(key, slowLoader),
    ]);

    // Only one loader call should have been made (stampede protection)
    expect(loaderCalls).toBe(1);

    // All results should be identical
    for (const r of results) {
      expect(r).toEqual({ id: "bill-stampede" });
    }
  });

  it("after inflight resolves, a new miss goes through the loader again", async () => {
    const key = cache.makeKey(TENANT, "bill", "bill-refetch");
    let loaderCalls = 0;

    const loader = async () => { loaderCalls++; return { id: "bill-refetch", v: loaderCalls }; };

    await cache.getOrLoad(key, loader);
    expect(loaderCalls).toBe(1);

    // Invalidate so next read is a miss
    await cache.invalidate(key);

    const second = await cache.getOrLoad(key, loader);
    expect(loaderCalls).toBe(2);
    expect(second).toEqual({ id: "bill-refetch", v: 2 });
  });

  it("loader error propagates to all concurrent waiters", async () => {
    const key = cache.makeKey(TENANT, "bill", "bill-error");

    const failingLoader = async (): Promise<null> => {
      throw new Error("DB connection failed");
    };

    const results = await Promise.allSettled([
      cache.getOrLoad(key, failingLoader),
      cache.getOrLoad(key, failingLoader),
      cache.getOrLoad(key, failingLoader),
    ]);

    // All should reject with the same error
    for (const r of results) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(Error);
        expect((r.reason as Error).message).toBe("DB connection failed");
      }
    }
  });
});
