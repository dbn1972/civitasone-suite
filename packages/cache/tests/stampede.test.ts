/**
 * SC-3: Cache stampede / thundering-herd protection
 *
 * Proves that N concurrent getOrLoad() calls against a cold cache key fire the
 * loader exactly once, no matter how many callers race simultaneously.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Cache, MemoryCache, resetInflightMap } from "../src/index.js";

beforeEach(() => {
  // Ensure a clean inflight map between tests.
  resetInflightMap();
});

describe("SC-3 getOrLoad stampede coalescing", () => {
  it("calls the loader exactly once when N concurrent requests hit a cold key", async () => {
    const store = new MemoryCache();
    const cache = new Cache({ service: "test", store });

    const key = cache.makeKey("tenant-sc3", "report", "42");

    let loaderCallCount = 0;

    // Simulate a loader that takes a non-trivial amount of time (deferred via
    // Promise resolution, which is enough to expose the race in a single event-
    // loop turn since all .getOrLoad calls below are enqueued before any
    // microtask flushes the loader result).
    const slowLoader = (): Promise<{ data: string } | null> =>
      new Promise((resolve) => {
        loaderCallCount++;
        // Resolve synchronously within the microtask queue (setTimeout(0) is
        // NOT used here deliberately — we want to test that the Map coalesces
        // before any resolution, which is guaranteed because all N calls are
        // launched synchronously before any await resolves).
        Promise.resolve().then(() => resolve({ data: "loaded" }));
      });

    // Launch 10 concurrent calls — all hit a cold cache at the same time.
    const CONCURRENT = 10;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () => cache.getOrLoad(key, slowLoader)),
    );

    // Every caller receives the correct value.
    expect(results).toHaveLength(CONCURRENT);
    for (const r of results) {
      expect(r).toEqual({ data: "loaded" });
    }

    // The loader was called exactly ONCE despite N concurrent requests.
    expect(loaderCallCount).toBe(1);
  });

  it("allows a fresh load after the inflight promise resolves (subsequent miss)", async () => {
    const store = new MemoryCache();
    const cache = new Cache({ service: "test", store });
    const key = cache.makeKey("tenant-sc3", "report", "99");

    let callCount = 0;
    const loader = async () => {
      callCount++;
      return { v: callCount };
    };

    // First call — cold cache, loader runs.
    const first = await cache.getOrLoad(key, loader);
    expect(first).toEqual({ v: 1 });
    expect(callCount).toBe(1);

    // Second call — value is now in cache, loader does NOT run.
    const second = await cache.getOrLoad(key, loader);
    expect(second).toEqual({ v: 1 });
    expect(callCount).toBe(1);
  });

  it("cleans up the inflight entry even when the loader rejects", async () => {
    const store = new MemoryCache();
    const cache = new Cache({ service: "test", store });
    const key = cache.makeKey("tenant-sc3", "report", "err");

    let callCount = 0;
    const failingLoader = async (): Promise<null> => {
      callCount++;
      throw new Error("DB unavailable");
    };

    // All concurrent failing calls should reject.
    const settled = await Promise.allSettled([
      cache.getOrLoad(key, failingLoader),
      cache.getOrLoad(key, failingLoader),
      cache.getOrLoad(key, failingLoader),
    ]);

    // All three promises rejected.
    expect(settled.every((r) => r.status === "rejected")).toBe(true);

    // Only ONE loader call despite three concurrent attempts.
    expect(callCount).toBe(1);

    // After rejection the inflight entry is cleaned up; a subsequent call retries the loader.
    callCount = 0;
    const retryLoader = async () => ({ recovered: true });
    const recovered = await cache.getOrLoad(key, retryLoader);
    expect(recovered).toEqual({ recovered: true });
  });
});
