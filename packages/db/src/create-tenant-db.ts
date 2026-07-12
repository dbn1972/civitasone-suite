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
  /** A Drizzle db bound to the tenant's tier (cached per underlying client). */
  dbFor(tenantId: string): Promise<PostgresJsDatabase<TSchema>>;
  /** Tenant isolation tier (for observability / routing decisions). */
  tierOf(tenantId: string): Promise<TenantTier>;
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
      d = drizzle(client, { schema });
      drizzleByClient.set(client, d);
    }
    return d;
  }

  async function tierOf(tenantId: string): Promise<TenantTier> {
    assertUuid(tenantId, "tierOf");
    return router.tierOf(tenantId);
  }

  return { sqlClient, db, router, sqlClientFor, dbFor, tierOf };
}
