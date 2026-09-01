/**
 * createTenantDb — reusable TenantRouter-adoption factory (Req 1.1–1.6).
 *
 * Generalizes the pattern already proven in `services/estab-service/src/shared/db.ts`
 * so every other service's `shared/db.ts` can become a thin, near-identical call site:
 *
 *   const { sqlClient, db, dbFor, sqlClientFor, tierOf } = createTenantDb({ schema: SCHEMA });
 *   export { sqlClient, db, dbFor, sqlClientFor, tierOf };
 *
 * Backward compatibility (Req 1.2, 1.3): with no `TENANT_SILO_IDS`/`TENANT_SHARD_MAP`
 * configured, the returned `router.sqlFor()` always resolves every tenant to the `pool`
 * tier and returns the exact same shared client instance used by `sqlClient`/`db` — so
 * adopting this helper changes nothing about existing pool-tier request handling, and
 * `db`/`sqlClient` remain the same bindings existing route handlers/consumers/repos import.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { redactLogPayload } from "@civitasone/observability";
import { createSqlClient, type SqlClientOptions } from "./pool.js";
import {
  TenantRouter,
  envTenantResolver,
  cachedResolver,
  type TenantResolver,
  type TenantTier,
} from "./tenant-router.js";
import { wrapWithTenantGuc } from "./wrap-tenant-db.js";

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SqlClient = ReturnType<typeof createSqlClient>;
type ClientFactory = (dsn: string, opts?: SqlClientOptions) => SqlClient;

/**
 * Structured WARN-level logger accepted by `dbForRead()` for its replica-fallback
 * path (Req 8.5). Matches the pino `logger.warn(mergingObject, msg)` call shape so
 * a real pino instance can be passed directly as `opts.logger` — this package does
 * not itself depend on pino. When omitted, a minimal JSON-to-stderr default is used
 * (mirrors `captureError`'s default sink in `@civitasone/observability`).
 */
export interface ReadRouterLogger {
  warn(payload: Record<string, unknown>, msg?: string): void;
}

const defaultLogger: ReadRouterLogger = {
  warn(payload, msg) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ level: "warn", msg: msg ?? "warn", ...payload }));
  },
};

export interface TenantDbOptions<TSchema extends Record<string, unknown>> {
  /** This service's Drizzle schema (merged module schemas + outbox schema). */
  schema: TSchema;
  /** Shared (pool-tier) DSN. Defaults to process.env.DATABASE_URL. */
  poolDsn?: string;
  /** Resolve a tenant's tier + dedicated DSN. Defaults to cachedResolver(envTenantResolver()). */
  resolver?: TenantResolver;
  /** postgres-js client options applied to every created client. */
  clientOptions?: SqlClientOptions;
  /** Max cached SILO/SHARD clients (LRU). Defaults to TenantRouter's own default. */
  maxSiloClients?: number;
  /** Read-replica DSN for `dbForRead()` (Req 8). Defaults to process.env.DATABASE_REPLICA_URL. */
  replicaDsn?: string;
  /** Injectable replica client factory for tests; defaults to createSqlClient. */
  replicaClientFactory?: ClientFactory;
  /** Structured WARN logger for `dbForRead()`'s replica-unreachable fallback (Req 8.5). */
  logger?: ReadRouterLogger;
}

export interface TenantDb<TSchema extends Record<string, unknown>> {
  /** The raw postgres-js client for the pool tier — unchanged export shape. */
  sqlClient: ReturnType<typeof createSqlClient>;
  /** Drizzle db bound to the pool tier, wrapped with tenant-GUC injection — unchanged export shape. */
  db: PostgresJsDatabase<TSchema>;
  /** The underlying TenantRouter, exposed for composition (e.g. read-router). */
  router: TenantRouter;
  /** The raw postgres-js client for a tenant (pool shared client or silo/shard client). */
  sqlClientFor(tenantId: string): Promise<ReturnType<typeof createSqlClient>>;
  /**
   * A Drizzle db bound to the tenant's tier (cached per underlying client),
   * wrapped with tenant-GUC injection — same `wrapWithTenantGuc` protection as
   * `db` above, so `dbFor(tenantId).transaction(...)` sets `app.tenant_id`
   * from the ambient tenant context exactly like the pool-tier `db` does. A
   * caller MUST still be inside a matching `runWithTenant(tenantId, ...)` (or
   * request-hook-established) context for the GUC to be set — `dbFor()` picks
   * which physical connection to use; it does not itself establish the
   * ambient tenant context that supplies the GUC value.
   */
  dbFor(tenantId: string): Promise<PostgresJsDatabase<TSchema>>;
  /** Tenant isolation tier (for observability / routing decisions). */
  tierOf(tenantId: string): Promise<TenantTier>;
  /**
   * Read-only accessor (Req 8): pool-tier reads go to the configured read
   * replica when reachable, falling back to the primary on any failure or
   * absent configuration; silo/shard tenants always read the primary. An
   * unresolvable tier rejects rather than returning any connection.
   * Wrapped with tenant-GUC injection on every path, same as `dbFor`.
   */
  dbForRead(tenantId: string): Promise<PostgresJsDatabase<TSchema>>;
}

function assertUuid(tenantId: string, fnName: string): void {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`createTenantDb.${fnName}: invalid tenantId (must be a UUID): ${tenantId}`);
  }
}

/**
 * Build the full `{ sqlClient, db, router, sqlClientFor, dbFor, tierOf }` surface for a
 * DB_Backed_Service's `shared/db.ts`, following the estab-service pattern.
 */
export function createTenantDb<TSchema extends Record<string, unknown>>(
  opts: TenantDbOptions<TSchema>,
): TenantDb<TSchema> {
  const { schema } = opts;
  const poolDsn = opts.poolDsn ?? process.env.DATABASE_URL;
  if (!poolDsn) throw new Error("createTenantDb: DATABASE_URL is required (or pass poolDsn)");

  const sqlClient = createSqlClient(poolDsn, opts.clientOptions);

  const rawDb = drizzle(sqlClient, { schema });
  const db = wrapWithTenantGuc(rawDb);

  // Pool tenants reuse the shared `sqlClient` above (no second connection); silo/shard
  // tenants get a client to their dedicated DB. With no TENANT_SILO_IDS/TENANT_SHARD_MAP
  // configured every tenant resolves to pool, so this is fully backward compatible.
  const router = new TenantRouter({
    poolDsn,
    resolver: opts.resolver ?? cachedResolver(envTenantResolver()),
    ...(opts.clientOptions !== undefined ? { clientOptions: opts.clientOptions } : {}),
    ...(opts.maxSiloClients !== undefined ? { maxSiloClients: opts.maxSiloClients } : {}),
    clientFactory: (dsn, clientOpts) => (dsn === poolDsn ? sqlClient : createSqlClient(dsn, clientOpts)),
  });

  const drizzleByClient = new WeakMap<ReturnType<typeof createSqlClient>, PostgresJsDatabase<TSchema>>();

  async function sqlClientFor(tenantId: string): Promise<ReturnType<typeof createSqlClient>> {
    assertUuid(tenantId, "sqlClientFor");
    return router.sqlFor(tenantId);
  }

  async function dbFor(tenantId: string): Promise<PostgresJsDatabase<TSchema>> {
    assertUuid(tenantId, "dbFor");
    const client = await router.sqlFor(tenantId);
    let d = drizzleByClient.get(client);
    if (!d) {
      // Wrapped exactly like `db` above: without this, dbFor()'s transaction()
      // never sets app.tenant_id, so any caller querying a FORCE ROW LEVEL
      // SECURITY table through it hits "unrecognized configuration parameter
      // app.tenant_id" — the same class of bug fixed piecemeal this session in
      // crm-service, revenue-service, knowledge-service, and install-service.
      d = wrapWithTenantGuc(drizzle(client, { schema }));
      drizzleByClient.set(client, d);
    }
    return d;
  }

  async function tierOf(tenantId: string): Promise<TenantTier> {
    assertUuid(tenantId, "tierOf");
    return router.tierOf(tenantId);
  }

  // ── Read_Router (Req 8): opt-in dbForRead(), additive to dbFor/db/sqlClient ──
  const replicaDsn = opts.replicaDsn ?? process.env.DATABASE_REPLICA_URL;
  const replicaFactory = opts.replicaClientFactory ?? createSqlClient;
  const logger = opts.logger ?? defaultLogger;
  let replicaClient: SqlClient | undefined;

  function getOrCreateReplicaClient(): SqlClient {
    if (!replicaClient) {
      replicaClient = replicaFactory(replicaDsn as string, opts.clientOptions);
    }
    return replicaClient;
  }

  async function dbForRead(tenantId: string): Promise<PostgresJsDatabase<TSchema>> {
    assertUuid(tenantId, "dbForRead");
    // Req 8.6: an unresolvable tier rejects rather than returning any connection.
    const tier = await router.tierOf(tenantId);

    // Req 8.2 + 8.4: no replica configured, or a silo/shard tenant (which always
    // reads its own dedicated primary) — behave identically to dbFor.
    if (!replicaDsn || tier !== "pool") {
      return dbFor(tenantId);
    }

    // Req 8.5: probe replica reachability; on failure, log exactly one WARN
    // (redacted) and fall back to the primary — dbForRead() never throws for a
    // missing/unreachable replica.
    try {
      const client = getOrCreateReplicaClient();
      await client`SELECT 1`;
      let d = drizzleByClient.get(client);
      if (!d) {
        // Same tenant-GUC wrap as the primary path in dbFor() above — a
        // replica-tier read still runs through an RLS-scoped connection.
        d = wrapWithTenantGuc(drizzle(client, { schema }));
        drizzleByClient.set(client, d);
      }
      return d;
    } catch (err) {
      logger.warn(
        redactLogPayload({ tenantId, err: err instanceof Error ? err.message : String(err) }),
        "read_replica_unreachable_fallback_to_primary",
      );
      return dbFor(tenantId);
    }
  }

  return { sqlClient, db, router, sqlClientFor, dbFor, tierOf, dbForRead };
}
