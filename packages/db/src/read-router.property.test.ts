/**
 * Read/write routing — property-based tests (task 3.2).
 *
 * Uses fast-check to validate the universal correctness property for
 * `dbForRead()`'s composition with `TenantRouter` and its fail-safe behavior.
 *
 *   - Property 7: Read/write routing composes with tenant-tier resolution and fails safe
 *
 * **Validates: Requirements 8.1, 8.4, 8.5, 8.6**
 *
 * No live Postgres connection is used: the pool/silo/shard DSNs are fake
 * `postgres://...` strings passed to the real `createSqlClient` (postgres-js
 * connects lazily, so constructing a client never opens a socket — the same
 * approach already used by `create-tenant-db.basic.test.ts` and
 * `tenant-router.property.test.ts`). The replica client is fully faked via
 * `replicaClientFactory` so its `SELECT 1` reachability probe can be made to
 * succeed or throw deterministically without any network I/O.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createTenantDb, type ReadRouterLogger } from "./create-tenant-db.js";
import type { SqlClientOptions, createSqlClient } from "./pool.js";
import type { TenantTier } from "./tenant-router.js";

type SqlClient = ReturnType<typeof createSqlClient>;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Fake schema — createTenantDb is generic over the schema shape and never queries it directly. */
const SCHEMA = {} as Record<string, unknown>;

/**
 * Fake replica client factory. The returned "client" is a callable function
 * (mirroring postgres-js's tagged-template client) whose invocation either
 * resolves (reachable) or throws (unreachable) — never touches a real socket.
 */
function makeFakeReplicaFactory(mode: "reachable" | "unreachable") {
  let queryCount = 0;
  let createCount = 0;
  const factory = ((_dsn: string, _opts?: SqlClientOptions): SqlClient => {
    createCount++;
    const fn = (async (..._args: unknown[]) => {
      queryCount++;
      if (mode === "unreachable") {
        throw new Error("replica unreachable: ECONNREFUSED");
      }
      return [];
    }) as unknown as SqlClient;
    // drizzle-orm's postgres-js driver reaches into `client.options.parsers`/
    // `serializers` at construction time — provide the minimal shape it needs
    // without a real postgres-js client.
    (fn as unknown as { options: { parsers: Record<string, unknown>; serializers: Record<string, unknown> } }).options = {
      parsers: {},
      serializers: {},
    };
    return fn;
  }) as (dsn: string, opts?: SqlClientOptions) => SqlClient;
  return { factory, getQueryCount: () => queryCount, getCreateCount: () => createCount };
}

/** Fake structured logger that records every WARN call. */
function makeFakeLogger() {
  const calls: Array<{ payload: Record<string, unknown>; msg: string | undefined }> = [];
  const logger: ReadRouterLogger = {
    warn(payload, msg) {
      calls.push({ payload, msg });
    },
  };
  return { logger, calls };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbUuid = fc.uuid();
const arbSiloOrShardTier = fc.constantFrom<TenantTier>("silo", "shard");
const arbAnyTier = fc.constantFrom<TenantTier>("pool", "silo", "shard");
const arbReplicaState = fc.constantFrom<"absent" | "reachable" | "unreachable">(
  "absent",
  "reachable",
  "unreachable",
);

function connectionStringFor(tier: TenantTier, tenantId: string): string {
  return `postgres://${tier}/${tenantId}`;
}

/** Build a resolver that always assigns `tier` to every tenant it's asked about. */
function fixedTierResolver(tier: TenantTier) {
  return (tenantId: string) =>
    tier === "pool" ? { tier: "pool" as const } : { tier, connectionString: connectionStringFor(tier, tenantId) };
}

// ---------------------------------------------------------------------------
// Property 7: Read/write routing composes with tenant-tier resolution and fails safe
// Validates: Requirements 8.1, 8.4, 8.5, 8.6
// ---------------------------------------------------------------------------

describe("Property 7: Read/write routing composes with tenant-tier resolution and fails safe", () => {
  it("pool-tier tenants route to the replica when configured and reachable", async () => {
    await fc.assert(
      fc.asyncProperty(arbUuid, async (tenantId) => {
        const { factory, getQueryCount } = makeFakeReplicaFactory("reachable");
        const { logger, calls } = makeFakeLogger();
        const t = createTenantDb({
          schema: SCHEMA,
          poolDsn: "postgres://shared/db",
          resolver: fixedTierResolver("pool"),
          replicaDsn: "postgres://replica/db",
          replicaClientFactory: factory,
          logger,
        });

        const readDb = await t.dbForRead(tenantId);
        const primaryDb = await t.dbFor(tenantId);

        // Derived from the replica, not the primary/pool connection.
        expect(readDb).not.toBe(primaryDb);
        // The reachability probe (`SELECT 1`) was actually issued.
        expect(getQueryCount()).toBeGreaterThan(0);
        // No fallback warning when the replica is reachable.
        expect(calls).toHaveLength(0);

        void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
      }),
      { numRuns: 100 },
    );
  });

  it("pool-tier tenants fall back to primary (never throwing) when the replica is absent or unreachable", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid,
        fc.constantFrom<"absent" | "unreachable">("absent", "unreachable"),
        async (tenantId, state) => {
          const { logger, calls } = makeFakeLogger();
          const baseOpts = {
            schema: SCHEMA,
            poolDsn: "postgres://shared/db",
            resolver: fixedTierResolver("pool"),
            logger,
          };

          const t =
            state === "absent"
              ? createTenantDb(baseOpts)
              : createTenantDb({
                  ...baseOpts,
                  replicaDsn: "postgres://replica/db",
                  replicaClientFactory: makeFakeReplicaFactory("unreachable").factory,
                });

          // Must resolve, never reject/throw, for a missing or unreachable replica.
          const readDb = await t.dbForRead(tenantId);
          const primaryDb = await t.dbFor(tenantId);

          expect(readDb).toBe(primaryDb);
          // Exactly one WARN per fallback when the replica was configured but
          // unreachable; no warning at all when no replica was configured.
          expect(calls).toHaveLength(state === "unreachable" ? 1 : 0);

          void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("silo/shard-tier tenants ALWAYS read primary, regardless of replica configuration", async () => {
    await fc.assert(
      fc.asyncProperty(arbUuid, arbSiloOrShardTier, arbReplicaState, async (tenantId, tier, replicaState) => {
        const { logger, calls } = makeFakeLogger();
        const baseOpts = {
          schema: SCHEMA,
          poolDsn: "postgres://shared/db",
          resolver: fixedTierResolver(tier),
          logger,
        };

        let queryCount = 0;
        const t =
          replicaState === "absent"
            ? createTenantDb(baseOpts)
            : (() => {
                const fake = makeFakeReplicaFactory(replicaState === "unreachable" ? "unreachable" : "reachable");
                const db = createTenantDb({
                  ...baseOpts,
                  replicaDsn: "postgres://replica/db",
                  replicaClientFactory: fake.factory,
                });
                queryCount = fake.getQueryCount();
                return db;
              })();

        const readDb = await t.dbForRead(tenantId);
        const primaryDb = await t.dbFor(tenantId);

        // Silo/shard tenants always resolve to their own dedicated primary —
        // never the replica, regardless of replica reachability/configuration.
        expect(readDb).toBe(primaryDb);
        // Never the shared pool client either.
        expect(readDb).not.toBe(t.db);
        // The replica was never even probed for a silo/shard tenant.
        expect(queryCount).toBe(0);
        expect(calls).toHaveLength(0);

        void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
        const siloClient = await t.sqlClientFor(tenantId);
        void siloClient.end({ timeout: 0 }).catch(() => undefined);
      }),
      { numRuns: 100 },
    );
  });

  it("when tier resolution fails/is unresolvable, dbForRead rejects rather than returning any connection", async () => {
    await fc.assert(
      fc.asyncProperty(arbUuid, async (tenantId) => {
        const t = createTenantDb({
          schema: SCHEMA,
          poolDsn: "postgres://shared/db",
          resolver: () => {
            throw new Error("tier unresolvable: registry unreachable");
          },
        });

        await expect(t.dbForRead(tenantId)).rejects.toThrow(/tier unresolvable/);

        void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
      }),
      { numRuns: 100 },
    );
  });

  it("dbForRead never throws for a missing/unreachable replica — it only ever rejects for the unresolvable-tier case", async () => {
    await fc.assert(
      fc.asyncProperty(arbUuid, arbAnyTier, arbReplicaState, async (tenantId, tier, replicaState) => {
        const baseOpts = {
          schema: SCHEMA,
          poolDsn: "postgres://shared/db",
          resolver: fixedTierResolver(tier), // never throws in this test
        };

        const t =
          replicaState === "absent"
            ? createTenantDb(baseOpts)
            : createTenantDb({
                ...baseOpts,
                replicaDsn: "postgres://replica/db",
                replicaClientFactory: makeFakeReplicaFactory(
                  replicaState === "unreachable" ? "unreachable" : "reachable",
                ).factory,
              });

        await expect(t.dbForRead(tenantId)).resolves.toBeDefined();

        void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
        if (tier !== "pool") {
          const siloClient = await t.sqlClientFor(tenantId);
          void siloClient.end({ timeout: 0 }).catch(() => undefined);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("dbForRead for two distinct silo/shard tenants always resolves to their own distinct dedicated clients", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbUuid, { minLength: 2, maxLength: 2 }),
        arbSiloOrShardTier,
        arbReplicaState,
        async (tenantPair, tier, replicaState) => {
          const [tenantA, tenantB] = tenantPair as [string, string];
          const baseOpts = {
            schema: SCHEMA,
            poolDsn: "postgres://shared/db",
            resolver: fixedTierResolver(tier),
          };

          const t =
            replicaState === "absent"
              ? createTenantDb(baseOpts)
              : createTenantDb({
                  ...baseOpts,
                  replicaDsn: "postgres://replica/db",
                  replicaClientFactory: makeFakeReplicaFactory(
                    replicaState === "unreachable" ? "unreachable" : "reachable",
                  ).factory,
                });

          const readA = await t.dbForRead(tenantA);
          const readB = await t.dbForRead(tenantB);

          // Each tenant's dbForRead is derived from its own tier resolution —
          // never another tenant's dedicated client, and never the shared pool client.
          expect(readA).not.toBe(readB);
          expect(readA).not.toBe(t.db);
          expect(readB).not.toBe(t.db);
          expect(readA).toBe(await t.dbFor(tenantA));
          expect(readB).toBe(await t.dbFor(tenantB));

          void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
          const clientA = await t.sqlClientFor(tenantA);
          const clientB = await t.sqlClientFor(tenantB);
          void clientA.end({ timeout: 0 }).catch(() => undefined);
          void clientB.end({ timeout: 0 }).catch(() => undefined);
        },
      ),
      { numRuns: 100 },
    );
  });
});
