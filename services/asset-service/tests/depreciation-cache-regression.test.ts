/**
 * depreciation/consumer.ts — depRun cache-invalidation regression.
 *
 * Live bug (asset-service sweep, 2026-09-29): after a depreciation run posts
 * entries, GET /v1/assets/assets/:id/depreciation kept returning the pre-run
 * cached copy (postedAt: null on every entry) for up to the cache's TTL
 * (60s) even though the DB write had already committed -- depRun's handler
 * (modules/depreciation/consumer.ts) only ever invalidated the "asset"
 * cache key, never "dep_entry" / "dep_schedule", the two keys
 * depreciation/queries.ts's read side actually serves from
 * (getDepEntries via cache.listKey, getDepSchedule via cache.makeKey).
 * Self-healed once the TTL elapsed -- a caching bug, not a data-correctness
 * bug (the DB write itself was always right). See consumer.ts's depRun
 * handler for the fix (mirrors the invalidation pattern already correct for
 * "asset") and asset-depreciation-chains.test.ts's new "Regression: depRun
 * cache invalidation ..." block for an end-to-end assertion on the real
 * consumer via the cross-service chain harness.
 *
 * This test uses the REAL Cache + MemoryCache store from @civitasone/cache
 * (same approach as journey-cache-regression.test.ts / tasks-cache-
 * regression.test.ts) so the actual read-through/invalidate path is
 * exercised, not a bare mock of getOrLoad/invalidate. shared/db.js is
 * mocked with a single mutable in-memory row that each test mutates
 * directly BETWEEN reads to stand in for "the DB write already committed"
 * (the live bug report is explicit the DB was always correct -- only the
 * cache lagged), so a fresh (post-invalidation) read can be told apart from
 * a stale cache hit.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// A single mutable "rows" slot, swapped out between reads via __setRows to
// simulate a DB write that has already committed. Both getDepSchedule
// (limit(1)) and getDepEntries (limit(500)) funnel through this same
// select().from().where().limit() shape -- each test below only ever
// exercises one of the two query functions, so no per-table branching is
// needed to keep them apart.
vi.mock("../src/shared/db.js", () => {
  let rows: unknown[] = [];
  return {
    db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) },
    scopedRead: async (cb: (tx: unknown) => unknown) =>
      cb({
        select: () => ({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        }),
      }),
    sqlClient: { end: async () => {} },
    __setRows: (next: unknown[]) => {
      rows = next;
    },
  };
});

// repo.ts also pulls in the cross-tenant scanner pool at import time (used
// only by the scheduler's findDueTenantPeriods, which this test never
// calls) -- stub it so this test needs no DATABASE_URL / live Postgres.
vi.mock("../src/shared/scanner-db.js", () => ({
  scannerSqlClient: { end: async () => {} },
  scannerDb: {},
}));

// A fresh, isolated real Cache + MemoryCache -- not the production
// singleton (which also constructs a queue client this test has no need for).
vi.mock("../src/shared/infra.js", async () => {
  const { Cache, MemoryCache } = await import("@civitasone/cache");
  return {
    cache: new Cache({ service: "asset-cache-regression-test", defaultTtlSeconds: 60, store: new MemoryCache() }),
  };
});

const dbMock = (await import("../src/shared/db.js")) as unknown as {
  __setRows: (rows: unknown[]) => void;
};
const queries = await import("../src/modules/depreciation/queries.js");
const { cache } = await import("../src/shared/infra.js");

const TENANT = "11111111-0000-0000-0000-000000000001";
const ASSET_ID = "33333333-0000-0000-0000-000000000001";

/** Loosely-typed accessor -- getOrLoad round-trips cached values through
 * JSON (see @civitasone/cache), so a cache HIT returns plain strings for
 * Date-typed columns like postedAt even though DepEntryRow types it as
 * `Date | null`. Matches journey-cache-regression.test.ts's approach of
 * casting through `unknown` rather than asserting against the (post-cache)
 * wrong static type. */
function field(row: unknown, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

beforeEach(() => {
  dbMock.__setRows([]);
});

describe("depreciation cache regression — dep_entry / dep_schedule reads go stale without invalidation, fresh with it", () => {
  it("getDepEntries: requires a dep_entry (listKey) invalidation before a posted entry's postedAt is visible again", async () => {
    const row = {
      id: "44444444-0000-0000-0000-000000000001",
      assetId: ASSET_ID,
      tenantId: TENANT,
      postedAt: null as string | null,
      glRef: null as string | null,
    };
    dbMock.__setRows([row]);

    // Simulates the GET moments before the run: cache MISS, caches the
    // pre-run (unposted) copy.
    const preRun = await queries.getDepEntries(TENANT, ASSET_ID);
    expect(field(preRun[0], "postedAt")).toBeNull();

    // Simulates depRun's DB write, already committed (the live bug report
    // is explicit the DB was always correct -- only the cache lagged).
    row.postedAt = "2026-09-29T00:00:00.000Z";
    row.glRef = `dep:company:${ASSET_ID}:2026-06`;
    dbMock.__setRows([row]);

    // Reproduces the live bug exactly: without invalidating the dep_entry
    // list key, the read-through cache keeps serving the pre-run copy.
    const staleRead = await queries.getDepEntries(TENANT, ASSET_ID);
    expect(field(staleRead[0], "postedAt")).toBeNull();

    // The fix: depRun's handler invalidates cache.listKey(tenantId,
    // "dep_entry", assetId) -- the exact key getDepEntries reads from.
    await cache.invalidate(cache.listKey(TENANT, "dep_entry", ASSET_ID));

    const freshRead = await queries.getDepEntries(TENANT, ASSET_ID);
    expect(field(freshRead[0], "postedAt")).toBe("2026-09-29T00:00:00.000Z");
  });

  it("getDepSchedule: requires a dep_schedule (makeKey) invalidation before a schedule-row change is visible again", async () => {
    const row = { id: "55555555-0000-0000-0000-000000000001", assetId: ASSET_ID, tenantId: TENANT, status: "active" };
    dbMock.__setRows([row]);

    const preRun = await queries.getDepSchedule(TENANT, ASSET_ID);
    expect(preRun!.status).toBe("active");

    // depRun does not itself change schedule status today, but
    // GET .../depreciation (routes.ts) serves getDepSchedule and
    // getDepEntries from the SAME response -- this confirms the key depRun
    // now also invalidates (cache.makeKey(tenantId, "dep_schedule",
    // assetId)) really is the one getDepSchedule reads from, so any future
    // schedule-row write in this flow can never be masked by a stale cache
    // the same way dep_entry's was.
    row.status = "closed";
    dbMock.__setRows([row]);

    const staleRead = await queries.getDepSchedule(TENANT, ASSET_ID);
    expect(staleRead!.status).toBe("active");

    await cache.invalidate(cache.makeKey(TENANT, "dep_schedule", ASSET_ID));

    const freshRead = await queries.getDepSchedule(TENANT, ASSET_ID);
    expect(freshRead!.status).toBe("closed");
  });
});
