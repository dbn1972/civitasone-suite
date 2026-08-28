/**
 * journeys/routes.ts — GET /v1/journeys/:id cache-hit regression test.
 *
 * Found live during the CEP-cluster deep-verify pass — the same pattern
 * field-service's tasks/routes.ts had (see PR #804): `cache.getOrLoad`
 * round-trips its cached value through JSON (see @civitasone/cache's
 * serialize/deserialize), so a Date field survives a cache MISS (the loader's
 * fresh row still has a real Date) but comes back as a plain string on every
 * cache HIT. The route used to cache the raw JourneyRow and call
 * repo.toView(journey) on the result unconditionally — toView() calls
 * `.toISOString()` on createdAt/updatedAt without checking the type, so every
 * cache hit for the same journey threw `TypeError: r.createdAt.toISOString is
 * not a function` and returned a 500. Reproduced live: the first GET for a
 * given journey succeeds (200), the very next GET for the same id within the
 * cache TTL fails.
 *
 * This test uses the REAL Cache class with the REAL (no-Redis-needed)
 * MemoryCache store from @civitasone/cache — not a mock of getOrLoad itself —
 * specifically so the actual JSON round-trip that caused the bug is
 * exercised, the same way the existing journey-routes.test.ts suite's
 * `H.cacheGetOrLoadMock.mockResolvedValue(...)` mock does NOT (it stubs the
 * whole call and never invokes a loader or touches serialization, which is
 * exactly why this bug shipped without a failing test).
 */
import { describe, it, expect, vi } from "vitest";
import { Cache, MemoryCache } from "@civitasone/cache";
import type { JourneyRow } from "../src/modules/journeys/schema.js";

// repo.ts pulls in shared/db.js at import time, which eagerly creates a real DB
// client requiring DATABASE_URL -- mocked here the same way tests/journey-routes.
// test.ts does, since this test only needs the pure toView() mapping function.
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(undefined) },
  scopedRead: async () => [],
  sqlClient: { end: async () => {} },
}));

const journeyRepo = await import("../src/modules/journeys/repo.js");

function fakeRow(overrides: Partial<JourneyRow> = {}): JourneyRow {
  const now = new Date("2026-08-27T12:00:00.000Z");
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    tenantId: "11111111-0000-0000-0000-000000000001",
    name: "Cache regression journey",
    status: "draft",
    triggerConfig: null,
    steps: [{ type: "send_notification", config: {} }],
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "aaaaaaaa-0000-4000-8000-000000000001",
    updatedBy: "aaaaaaaa-0000-4000-8000-000000000001",
    ...overrides,
  } as JourneyRow;
}

describe("GET /v1/journeys/:id — cache-hit does not 500 (RELIABILITY regression)", () => {
  it("a second getOrLoad call for the same key (cache HIT) returns the same shape as the first (cache MISS), no throw", async () => {
    const cache = new Cache({ service: "journey-test", defaultTtlSeconds: 60, store: new MemoryCache() });
    const row = fakeRow();
    const cacheKey = cache.makeKey(row.tenantId, "journey", row.id);

    let loaderCalls = 0;
    const loader = async () => {
      loaderCalls++;
      return journeyRepo.toView(row);
    };

    // First call: cache MISS -- loader runs, result gets cached.
    const first = await cache.getOrLoad(cacheKey, loader);
    expect(first).not.toBeNull();
    expect(first!.createdAt).toBe("2026-08-27T12:00:00.000Z");
    expect(loaderCalls).toBe(1);

    // Second call: cache HIT -- must NOT re-run the loader, and must NOT throw
    // despite the value having round-tripped through JSON in between.
    const second = await cache.getOrLoad(cacheKey, loader);
    expect(second).not.toBeNull();
    expect(second!.createdAt).toBe("2026-08-27T12:00:00.000Z");
    expect(second).toEqual(first);
    expect(loaderCalls).toBe(1); // still 1 -- confirms this really was a cache hit, not a fluke
  });

  it("regression guard: caching the RAW row (pre-fix shape) instead of the view is what broke -- calling toView on a JSON-round-tripped row throws", async () => {
    const cache = new Cache({ service: "journey-test-prefix", defaultTtlSeconds: 60, store: new MemoryCache() });
    const row = fakeRow({ id: "cccccccc-0000-4000-8000-000000000002" });
    const cacheKey = cache.makeKey(row.tenantId, "journey", row.id);

    // This mirrors the OLD (buggy) route: cache the raw row, call toView() after.
    await cache.getOrLoad(cacheKey, async () => row);
    const cachedRow = await cache.getOrLoad(cacheKey, async () => row);

    // cachedRow's createdAt is now a plain string (JSON round-trip), not a Date --
    // confirms the exact failure mode this PR's actual fix avoids by caching the
    // view instead of the row.
    expect(typeof (cachedRow as unknown as { createdAt: unknown }).createdAt).toBe("string");
    expect(() => journeyRepo.toView(cachedRow as unknown as JourneyRow)).toThrow(
      /toISOString is not a function/,
    );
  });
});
