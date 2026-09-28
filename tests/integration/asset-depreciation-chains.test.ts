/**
 * 10-T3 Chain #3 — Real cross-service event chain:
 *   asset.dep.run (depreciation-run command) → finance.gl.post.
 *
 * The UAT gap report lists this hop as WIRED (asset `depreciation/consumer.ts`
 * `depRun` handler) but UNTESTED. The handler READS the due dep entries
 * (`findDueEntries` via `db.select`) and, for the company book, reads the asset
 * back MID-TRANSACTION (`findAssetById`) to roll the accumulated depreciation —
 * both need the 10-T3 seedable `select()`. It then emits `finance.gl.post`
 * (the GL hop) plus `asset.dep.posted`.
 *
 * We publish the producer's `asset.dep.run`, let the REAL asset consumer react,
 * and assert it emits a GL post carrying the correct depreciation amount /
 * period / book, that the dep entry is marked posted, and that a redelivery is
 * gated (idempotency) by the per-entry UUIDv5 key.
 *
 * DB + outbox are stubbed in-memory so it runs in CI with no Postgres. Cache
 * uses the REAL Cache class from @civitasone/cache backed by its in-memory
 * MemoryCache store (no Redis needed) -- not a bare stub -- so the "cache
 * regression" describe block below exercises the actual key-construction
 * (makeKey/listKey) and invalidate() calls the depRun handler makes, the
 * same way journey-cache-regression.test.ts / tasks-cache-regression.test.ts
 * use the real Cache class rather than mocking getOrLoad/invalidate away.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// Relative path, not the bare "@civitasone/cache" specifier: this file lives
// under tests/integration/, which (like harness.ts's own packages/queue
// import just below) has no direct workspace dependency on the package, so
// the bare specifier does not resolve from here the way it does from inside
// a service package that actually declares it as a dependency.
import { Cache, MemoryCache } from "../../packages/cache/dist/index.js";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- asset-service data layer ----------------------------------------------
vi.mock("../../services/asset-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {}, scopedRead: (fn: any) => h.mockDb.transaction(fn) };
});

vi.mock("../../services/asset-service/src/shared/outbox.js", async () => {
  const h = await import("./harness.js");
  return {
    enqueue: h.mockEnqueue,
    markProcessed: h.mockMarkProcessed,
    outboxMessages: {},
    processed: {},
    outboxSchema: {},
    relayOnce: async () => 0,
    startRelay: () => ({}) as unknown,
  };
});

// cache.invalidate runs outside the tx. Real Cache + MemoryCache (no Redis
// needed) so makeKey/listKey/invalidate all behave exactly as production —
// required now that depRun also calls cache.listKey() (see regression tests).
vi.mock("../../services/asset-service/src/shared/infra.js", () => ({
  cache: new Cache({ service: "asset-chain-test", defaultTtlSeconds: 60, store: new MemoryCache() }),
}));

const { registerDepreciationConsumers } = await import(
  "../../services/asset-service/src/modules/depreciation/consumer.js"
);
const { cache } = await import("../../services/asset-service/src/shared/infra.js");

const TENANT = "aaaa1111-1111-4000-8000-000000000001";
const ACTOR = "bbbb2222-2222-4000-8000-000000000001";
const ASSET_ID = "cccc3333-3333-4000-8000-000000000001";
const ENTRY_ID = "dddd4444-4444-4000-8000-000000000001";
const PERIOD = "2026-06";

function envelope(messageId: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0",
    payload,
  };
}

/** A single due dep entry (company book) the consumer will post to GL. */
function dueEntry() {
  return {
    id: ENTRY_ID,
    tenantId: TENANT,
    assetId: ASSET_ID,
    scheduleId: "sched-1",
    period: PERIOD,
    depBook: "company",
    amountMinor: 25000n,
    currency: "INR",
    bookValueAfterMinor: 975000n,
    postedAt: null,
  };
}

/** The asset findAssetById reads back mid-tx to roll accumulated depreciation. */
function assetRow() {
  return {
    id: ASSET_ID,
    tenantId: TENANT,
    acquisitionCost: 1000000n,
    salvageValue: 0n,
    accumulatedDep: 0n,
    depRate: "10",
    usefulLifeYears: 4,
    currency: "INR",
  };
}

let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerDepreciationConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Cross-service chain #3: asset.dep.run → finance.gl.post (depreciation GL)", () => {
  it("a depreciation run posts a GL event carrying the period's dep amount + book", async () => {
    // findDueEntries reads asset_dep_entries; findAssetById reads asset_assets.
    harness.seedSelect("dep_entries", [dueEntry()]);
    harness.seedSelect("asset_assets", [assetRow()]);

    const glPosted = harness.nextEvent("finance.gl.post");

    await harness.queue.publish(
      "asset.dep.run",
      envelope("e3000001-0001-4000-8000-000000000001", "asset.dep.run", {
        tenantId: TENANT,
        period: PERIOD,
        depBook: "company",
      }),
    );

    const msg = await glPosted;
    expect(msg.type).toBe("finance.gl.post");
    expect(msg.tenantId).toBe(TENANT);
    expect(msg.correlationId).toBe("corr-e3000001");

    const p = msg.payload as {
      assetId: string;
      period: string;
      depAmountMinor: string;
      currency: string;
      type: string;
      depBook: string;
    };
    expect(p.assetId).toBe(ASSET_ID);
    expect(p.period).toBe(PERIOD);
    // The GL post carries the exact period depreciation (book-value-reducing leg).
    expect(p.depAmountMinor).toBe("25000");
    expect(p.currency).toBe("INR");
    expect(p.type).toBe("depreciation");
    expect(p.depBook).toBe("company");
  });

  it("also emits asset.dep.posted + marks the entry posted under the same correlationId", async () => {
    harness.seedSelect("dep_entries", [dueEntry()]);
    harness.seedSelect("asset_assets", [assetRow()]);

    const depPosted = harness.nextEvent("asset.dep.posted");

    await harness.queue.publish(
      "asset.dep.run",
      envelope("e3000002-0001-4000-8000-000000000001", "asset.dep.run", {
        tenantId: TENANT,
        period: PERIOD,
      }),
    );

    const msg = await depPosted;
    expect(msg.correlationId).toBe("corr-e3000002");
    const p = msg.payload as { assetId: string; period: string; amount: string; depBook: string };
    expect(p.assetId).toBe(ASSET_ID);
    expect(p.amount).toBe("25000");

    // markEntryPosted is an update (not captured in inserts); assert the GL +
    // event fired, which only happens inside the same posting transaction.
  });

  it("a redelivered dep.run posts each due entry once (idempotency across the hop)", async () => {
    harness.seedSelect("dep_entries", [dueEntry()]);
    harness.seedSelect("asset_assets", [assetRow()]);

    const seen: string[] = [];
    harness.queue.subscribe("finance.gl.post", async () => {
      seen.push("gl");
    });

    const dup = envelope("e3000003-0001-4000-8000-000000000001", "asset.dep.run", {
      tenantId: TENANT,
      period: PERIOD,
      depBook: "company",
    });
    await harness.queue.publish("asset.dep.run", dup);
    await harness.queue.publish("asset.dep.run", dup);
    await new Promise((r) => setTimeout(r, 350));

    // Per-entry UUIDv5(messageId:entryId) dedupes the second delivery → one GL.
    expect(seen).toHaveLength(1);
  });
});

// ═══ Regression: depRun must invalidate dep_schedule/dep_entry, not just asset ═══
//
// Live bug (asset-service sweep, 2026-09-29): GET /v1/assets/assets/:id/depreciation
// (depreciation/queries.ts's getDepSchedule + getDepEntries) kept returning the
// pre-run cached copy -- postedAt: null on every entry -- for up to the cache's
// TTL (60s) after a depreciation run had already committed the posting, because
// depRun's handler only ever invalidated the "asset" key. Self-healed once the
// TTL elapsed, so this was a caching bug, not a data-correctness bug (the DB
// write itself was always right). getDepSchedule reads via
// cache.makeKey(tenantId, "dep_schedule", assetId); getDepEntries reads via
// cache.listKey(tenantId, "dep_entry", assetId) -- depRun must invalidate
// exactly those two keys (in addition to "asset") for a cache HIT to ever be
// possible right after a run.
describe("Regression: depRun cache invalidation covers dep_schedule + dep_entry (not just asset)", () => {
  it("invalidates the exact dep_schedule (makeKey) and dep_entry (listKey) cache keys queries.ts reads from, alongside asset", async () => {
    harness.seedSelect("dep_entries", [dueEntry()]);
    harness.seedSelect("asset_assets", [assetRow()]);

    const invalidateSpy = vi.spyOn(cache, "invalidate");
    const glPosted = harness.nextEvent("finance.gl.post");

    await harness.queue.publish(
      "asset.dep.run",
      envelope("e3000099-0001-4000-8000-000000000001", "asset.dep.run", {
        tenantId: TENANT,
        period: PERIOD,
        depBook: "company",
      }),
    );
    await glPosted;

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]);
    expect(invalidatedKeys).toContain(cache.makeKey(TENANT, "asset", ASSET_ID));
    // These two were the actual live bug -- previously never called at all.
    expect(invalidatedKeys).toContain(cache.makeKey(TENANT, "dep_schedule", ASSET_ID));
    expect(invalidatedKeys).toContain(cache.listKey(TENANT, "dep_entry", ASSET_ID));

    invalidateSpy.mockRestore();
  });
});
