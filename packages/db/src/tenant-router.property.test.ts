/**
 * TenantRouter — property-based tests (tasks 1.2, 1.3).
 *
 * Uses fast-check to validate universal correctness properties for tier
 * resolution and the silo/shard client LRU cache in `tenant-router.ts`.
 *
 *   - Property 1: Tenant tier resolution is pure and backward-compatible
 *   - Property 2: Silo/shard client cache respects its LRU cap
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  TenantRouter,
  envTenantResolver,
  envShardResolver,
  type TenantResolver,
  type TenantConnInfo,
} from "./tenant-router.js";
import { createTenantDb } from "./create-tenant-db.js";

// ---------------------------------------------------------------------------
// Fake postgres-js client factory (no real network connection) — mirrors the
// fake used in tenant-router.test.ts.
// ---------------------------------------------------------------------------
function fakeFactory() {
  const created: Array<{ dsn: string; ended: boolean }> = [];
  const factory = ((dsn: string) => {
    const c = { dsn, ended: false, end: async () => { c.ended = true; } };
    created.push(c);
    return c as unknown as ReturnType<typeof import("./pool.js").createSqlClient>;
  });
  return { factory: factory as never, created };
}

/** Arbitrary UUID-shaped tenantId string. */
const arbUuid = fc.uuid();

/** Arbitrary non-UUID-shaped string (best-effort — filtered against the UUID regex). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arbNonUuid = fc.string().filter((s) => !UUID_RE.test(s));

/** Arbitrary set of tenantIds mapped to the silo tier, plus the resolver config that produces it. */
const arbSiloIdSet = fc.uniqueArray(arbUuid, { minLength: 0, maxLength: 10 });

// ---------------------------------------------------------------------------
// Property 1: Tenant tier resolution is pure and backward-compatible
// Validates: Requirements 1.2, 1.4, 1.5, 7.4, 8.2
// ---------------------------------------------------------------------------

describe("Property 1: Tenant tier resolution is pure and backward-compatible", () => {
  it("tierOf(tenantId) is deterministic for a fixed resolver configuration", async () => {
    await fc.assert(
      fc.asyncProperty(arbSiloIdSet, arbUuid, async (siloIds, tenantId) => {
        const idSet = new Set(siloIds.map((s) => s.toLowerCase()));
        const resolver: TenantResolver = (id: string): TenantConnInfo =>
          idSet.has(id.toLowerCase())
            ? { tier: "silo", connectionString: `postgres://silo/${id}` }
            : { tier: "pool" };
        const { factory } = fakeFactory();
        const router = new TenantRouter({ poolDsn: "postgres://shared", resolver, clientFactory: factory });

        const first = await router.tierOf(tenantId);
        const second = await router.tierOf(tenantId);
        const third = await router.tierOf(tenantId);

        expect(second).toBe(first);
        expect(third).toBe(first);
      }),
      { numRuns: 100 },
    );
  });

  it("a tenantId absent from TENANT_SILO_IDS/TENANT_SHARD_MAP always resolves to pool (backward compatible)", () => {
    fc.assert(
      fc.property(arbUuid, arbSiloIdSet, (tenantId, siloIds) => {
        // tenantId is guaranteed absent from the configured silo set by construction below.
        const idSet = new Set(siloIds.map((s) => s.toLowerCase()).filter((s) => s !== tenantId.toLowerCase()));
        const prevIds = process.env.TENANT_SILO_IDS;
        const prevTpl = process.env.TENANT_SILO_DSN_TEMPLATE;
        const prevShard = process.env.TENANT_SHARD_MAP;
        try {
          process.env.TENANT_SILO_IDS = [...idSet].join(",");
          process.env.TENANT_SILO_DSN_TEMPLATE = "postgres://h/civitas_tenant_{tenant}";
          delete process.env.TENANT_SHARD_MAP;

          const resolve = envTenantResolver();
          expect(resolve(tenantId)).toEqual({ tier: "pool" });

          const resolveShard = envShardResolver();
          expect(resolveShard(tenantId)).toEqual({ tier: "pool" });
        } finally {
          process.env.TENANT_SILO_IDS = prevIds;
          process.env.TENANT_SILO_DSN_TEMPLATE = prevTpl;
          process.env.TENANT_SHARD_MAP = prevShard;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("with no TENANT_SILO_IDS/TENANT_SHARD_MAP configured at all, every tenantId resolves to pool", () => {
    fc.assert(
      fc.property(arbUuid, (tenantId) => {
        const prevIds = process.env.TENANT_SILO_IDS;
        const prevTpl = process.env.TENANT_SILO_DSN_TEMPLATE;
        const prevShard = process.env.TENANT_SHARD_MAP;
        try {
          delete process.env.TENANT_SILO_IDS;
          delete process.env.TENANT_SILO_DSN_TEMPLATE;
          delete process.env.TENANT_SHARD_MAP;

          expect(envTenantResolver()(tenantId)).toEqual({ tier: "pool" });
          expect(envShardResolver()(tenantId)).toEqual({ tier: "pool" });
        } finally {
          process.env.TENANT_SILO_IDS = prevIds;
          process.env.TENANT_SILO_DSN_TEMPLATE = prevTpl;
          process.env.TENANT_SHARD_MAP = prevShard;
        }
      }),
      { numRuns: 50 },
    );
  });

  it("sqlFor for any set of different pool-tier tenants returns the same underlying client instance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbUuid, { minLength: 2, maxLength: 8 }),
        async (tenantIds) => {
          const { factory } = fakeFactory();
          // Every tenant resolves to pool (no silo/shard configured).
          const router = new TenantRouter({
            poolDsn: "postgres://shared",
            resolver: () => ({ tier: "pool" }),
            clientFactory: factory,
          });

          const clients = await Promise.all(tenantIds.map((id) => router.sqlFor(id)));
          const first = clients[0];
          for (const c of clients) {
            expect(c).toBe(first);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("createTenantDb.dbFor for any two different pool-tier tenants resolve to the same drizzle db instance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbUuid, { minLength: 2, maxLength: 8 }),
        async (tenantIds) => {
          const t = createTenantDb({
            schema: {},
            poolDsn: "postgres://shared",
            resolver: () => ({ tier: "pool" }),
          });
          const dbs = await Promise.all(tenantIds.map((id) => t.dbFor(id)));
          const first = dbs[0];
          for (const d of dbs) {
            expect(d).toBe(first);
          }
          const clients = await Promise.all(tenantIds.map((id) => t.sqlClientFor(id)));
          for (const c of clients) {
            expect(c).toBe(t.sqlClient);
          }
          void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("for a non-UUID-shaped string, sqlFor/dbFor/tierOf/dbForRead always reject rather than attempt a connection", async () => {
    await fc.assert(
      fc.asyncProperty(arbNonUuid, async (badId) => {
        const { factory, created } = fakeFactory();
        const router = new TenantRouter({ poolDsn: "postgres://shared", resolver: () => ({ tier: "pool" }), clientFactory: factory });
        await expect(router.sqlFor(badId)).rejects.toThrow();
        expect(created).toHaveLength(0);

        const t = createTenantDb({ schema: {}, poolDsn: "postgres://shared", resolver: () => ({ tier: "pool" }) });
        await expect(t.sqlClientFor(badId)).rejects.toThrow();
        await expect(t.dbFor(badId)).rejects.toThrow();
        await expect(t.tierOf(badId)).rejects.toThrow();
        await expect(t.dbForRead(badId)).rejects.toThrow();
        void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Silo/shard client cache respects its LRU cap
// Validates: Requirements 1.6
// ---------------------------------------------------------------------------

describe("Property 2: Silo/shard client cache respects its LRU cap", () => {
  it("the number of live cached silo clients never exceeds maxSiloClients", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 25 }),
        fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 0, maxLength: 60 }),
        async (maxSiloClients, accessSequence) => {
          const { factory, created } = fakeFactory();
          // Each distinct index maps to a distinct silo DSN/tenant.
          const resolver: TenantResolver = (id: string) => ({ tier: "silo", connectionString: `postgres://silo/${id}` });
          const router = new TenantRouter({
            poolDsn: "postgres://shared",
            resolver,
            clientFactory: factory,
            maxSiloClients,
          });

          for (const idx of accessSequence) {
            const tenantId = `${String(idx).padStart(8, "0")}-0000-4000-8000-000000000000`;
            await router.sqlFor(tenantId);
            const liveCount = created.filter((c) => !c.ended).length;
            expect(liveCount).toBeLessThanOrEqual(maxSiloClients);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("whenever an eviction occurs, the evicted client is always the least-recently-touched one", async () => {
    type FakeClient = { dsn: string; ended: boolean };
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 1, maxLength: 40 }),
        async (maxSiloClients, accessSequence) => {
          const { factory, created } = fakeFactory();
          const resolver: TenantResolver = (id: string) => ({ tier: "silo", connectionString: `postgres://silo/${id}` });
          const router = new TenantRouter({
            poolDsn: "postgres://shared",
            resolver,
            clientFactory: factory,
            maxSiloClients,
          });

          // Track access order by *object reference* (most-recently-touched last), keyed by
          // DSN, mirroring the router's own LRU bookkeeping. Using references (not DSN
          // strings) avoids ambiguity when a DSN is evicted and later re-created as a new
          // client object.
          const touchOrder: FakeClient[] = [];
          const liveByDsn = new Map<string, FakeClient>();

          function toTenantId(idx: number): string {
            return `${String(idx).padStart(8, "0")}-0000-4000-8000-000000000000`;
          }

          for (const idx of accessSequence) {
            const tenantId = toTenantId(idx);
            const dsn = `postgres://silo/${tenantId}`;

            const preExisting = liveByDsn.get(dsn);
            const preLiveCount = liveByDsn.size;

            const beforeCreatedLength = created.length;
            await router.sqlFor(tenantId);
            const createdNew = created.length > beforeCreatedLength;

            if (preExisting && !createdNew) {
              // Touching an existing entry moves it to the most-recently-used position.
              const at = touchOrder.indexOf(preExisting);
              touchOrder.splice(at, 1);
              touchOrder.push(preExisting);
            } else {
              const wasAtCap = preLiveCount >= maxSiloClients;
              const newClient = created[created.length - 1] as FakeClient;
              if (wasAtCap) {
                // The router must evict the least-recently-touched entry (index 0, before the push).
                const expectedEvicted = touchOrder[0];
                touchOrder.shift();
                liveByDsn.delete(expectedEvicted!.dsn);
                expect(expectedEvicted?.ended).toBe(true);
              }
              touchOrder.push(newClient);
              liveByDsn.set(dsn, newClient);
            }

            // Invariant: every reference still tracked in touchOrder must be live; every
            // reference not tracked (i.e. evicted) must have been ended.
            for (const c of created) {
              if (touchOrder.includes(c)) {
                expect(c.ended).toBe(false);
              } else {
                expect(c.ended).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a more-recently-accessed client is never evicted before a less-recently-accessed one", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async (maxSiloClients) => {
        const { factory, created } = fakeFactory();
        const resolver: TenantResolver = (id: string) => ({ tier: "silo", connectionString: `postgres://silo/${id}` });
        const router = new TenantRouter({
          poolDsn: "postgres://shared",
          resolver,
          clientFactory: factory,
          maxSiloClients,
        });

        function toTenantId(idx: number): string {
          return `${String(idx).padStart(8, "0")}-0000-4000-8000-000000000000`;
        }

        // Fill the cache to capacity.
        for (let i = 0; i < maxSiloClients; i++) {
          await router.sqlFor(toTenantId(i));
        }
        // Re-touch tenant 0 so it becomes the most-recently-used entry.
        await router.sqlFor(toTenantId(0));
        // Adding one more distinct tenant forces an eviction — tenant 1 (now the
        // least-recently-touched) must be evicted, never tenant 0.
        await router.sqlFor(toTenantId(maxSiloClients));

        const client0 = created.find((c) => c.dsn === `postgres://silo/${toTenantId(0)}`);
        const client1 = created.find((c) => c.dsn === `postgres://silo/${toTenantId(1)}`);
        expect(client0?.ended).toBe(false);
        expect(client1?.ended).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});
