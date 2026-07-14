/**
 * Read/write routing — concrete edge-case unit tests (task 3.3).
 *
 * Complements `read-router.property.test.ts` (Property 7, fast-check) with
 * specific, deterministic examples for `dbForRead()`'s three documented edge
 * cases:
 *   - No replica configured behaves identically to `dbFor` (Req 8.2)
 *   - An unreachable replica logs EXACTLY ONE WARN and falls back to primary,
 *     never throwing (Req 8.5)
 *   - An unresolvable tier rejects rather than returning any connection (Req 8.6)
 *
 * No live Postgres connection is used: DSNs are fake `postgres://...` strings
 * (postgres-js connects lazily) and the replica client is fully faked via
 * `replicaClientFactory`, matching the pattern already used in
 * `create-tenant-db.basic.test.ts` and `read-router.property.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { createTenantDb, type ReadRouterLogger } from "./create-tenant-db.js";
import type { SqlClientOptions, createSqlClient } from "./pool.js";

type SqlClient = ReturnType<typeof createSqlClient>;

// Avoid a UUID whose last hyphen-delimited segment is 12 consecutive digits —
// the redaction util in `@civitasone/observability` treats any 12-digit run
// as Aadhaar-shaped and redacts it, even inside unrelated fields like `tenantId`.
const T_POOL = "33333333-3333-3333-3333-33333333abcd";

/** Fake schema — createTenantDb is generic over the schema shape and never queries it directly. */
const SCHEMA = {} as Record<string, unknown>;

/**
 * Fake replica client factory whose returned "client" is a callable function
 * (mirroring postgres-js's tagged-template client). Invoking it either
 * resolves (reachable) or throws (unreachable) — never touches a real socket.
 */
function makeFakeReplicaFactory(mode: "reachable" | "unreachable") {
  let queryCount = 0;
  const factory = ((_dsn: string, _opts?: SqlClientOptions): SqlClient => {
    const fn = (async (..._args: unknown[]) => {
      queryCount++;
      if (mode === "unreachable") {
        throw new Error("replica unreachable: ECONNREFUSED");
      }
      return [];
    }) as unknown as SqlClient;
    // drizzle-orm's postgres-js driver reaches into `client.options.parsers`/
    // `serializers` at construction time — provide the minimal shape it needs.
    (
      fn as unknown as { options: { parsers: Record<string, unknown>; serializers: Record<string, unknown> } }
    ).options = { parsers: {}, serializers: {} };
    return fn;
  }) as (dsn: string, opts?: SqlClientOptions) => SqlClient;
  return { factory, getQueryCount: () => queryCount };
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

describe("dbForRead() edge cases (task 3.3)", () => {
  it("no replica configured (no replicaDsn option, DATABASE_REPLICA_URL unset): dbForRead returns the exact same instance as dbFor for a pool tenant", async () => {
    const prevReplica = process.env.DATABASE_REPLICA_URL;
    delete process.env.DATABASE_REPLICA_URL;

    const t = createTenantDb({
      schema: SCHEMA,
      poolDsn: "postgres://shared/db",
      // No `replicaDsn` option passed — resolver defaults every tenant to pool.
    });

    const dbForResult = await t.dbFor(T_POOL);
    const dbForReadResult = await t.dbForRead(T_POOL);

    expect(dbForReadResult).toBe(dbForResult);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
    if (prevReplica === undefined) delete process.env.DATABASE_REPLICA_URL;
    else process.env.DATABASE_REPLICA_URL = prevReplica;
  });

  it("replica configured but unreachable: dbForRead logs EXACTLY ONE WARN via the injected logger and falls back to primary without throwing", async () => {
    const { factory, getQueryCount } = makeFakeReplicaFactory("unreachable");
    const { logger, calls } = makeFakeLogger();

    const t = createTenantDb({
      schema: SCHEMA,
      poolDsn: "postgres://shared/db",
      replicaDsn: "postgres://replica/db",
      replicaClientFactory: factory,
      logger,
    });

    const dbForResult = await t.dbFor(T_POOL);
    const dbForReadResult = await t.dbForRead(T_POOL);

    // Falls back to the exact primary connection, never throwing.
    expect(dbForReadResult).toBe(dbForResult);
    // The reachability probe was actually attempted.
    expect(getQueryCount()).toBe(1);
    // Exactly one WARN — not zero, not multiple.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.msg).toBe("read_replica_unreachable_fallback_to_primary");
    expect(calls[0]?.payload).toMatchObject({ tenantId: T_POOL });

    // Calling dbForRead again for the same tenant logs a second, independent
    // WARN per call (one WARN per fallback occurrence, not a one-time latch).
    await t.dbForRead(T_POOL);
    expect(calls).toHaveLength(2);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("an unresolvable tier (resolver throws) rejects dbForRead with the resolver's error, never returning any connection", async () => {
    const resolverError = new Error("tier registry unreachable: ETIMEDOUT");
    const t = createTenantDb({
      schema: SCHEMA,
      poolDsn: "postgres://shared/db",
      resolver: () => {
        throw resolverError;
      },
    });

    const sentinel = Symbol("not-resolved");
    let resolved: unknown = sentinel;
    await t.dbForRead(T_POOL).then(
      (db) => {
        resolved = db;
      },
      () => {
        // expected rejection path — resolved stays untouched
      },
    );

    // The promise must never resolve to a connection — it should still be
    // the untouched sentinel because dbForRead rejected instead.
    expect(resolved).toBe(sentinel);
    await expect(t.dbForRead(T_POOL)).rejects.toBe(resolverError);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });
});
