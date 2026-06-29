/**
 * Tenant-aware connection routing — the keystone for tiered multi-tenancy.
 *
 * Two isolation tiers behind ONE interface (Option B + tiering):
 *  - **pool**  (default): the tenant lives in the shared per-service database
 *    (today's behaviour), isolated by `tenant_id` + RLS.
 *  - **silo**  (premium / regulated): the tenant has its OWN dedicated database
 *    that hosts every service's schema (budget, gl, files, …). All services
 *    connect to that tenant DB and read/write only their own pg schema, so the
 *    Drizzle models are unchanged — only the connection target differs.
 *
 * Services call `router.sqlFor(tenantId)` (or `dbFor`) instead of a module-level
 * singleton. Pool tenants resolve to the shared client; silo tenants resolve to
 * a cached client for their dedicated DB. Clients are pooled and LRU-capped.
 *
 * The tier/DSN source is pluggable via a `TenantResolver` (back it with the
 * tenant registry + Redis in production). The built-in default is env-driven and
 * requires no network, so it is fully backward compatible: with no config every
 * tenant is `pool` and behaviour is identical to `createSqlClient`.
 */
import { createSqlClient, type SqlClientOptions } from "./pool.js";

export type TenantTier = "pool" | "silo";

export interface TenantConnInfo {
  tier: TenantTier;
  /** Required for silo: the dedicated DB DSN for this tenant. */
  connectionString?: string;
}

export type TenantResolver = (tenantId: string) => Promise<TenantConnInfo> | TenantConnInfo;

type SqlClient = ReturnType<typeof createSqlClient>;
type ClientFactory = (dsn: string, opts?: SqlClientOptions) => SqlClient;

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantRouterOptions {
  /** Shared (pool-tier) DSN for this service. Defaults to DATABASE_URL. */
  poolDsn?: string;
  /** Resolve a tenant's tier + dedicated DSN. Defaults to the env resolver. */
  resolver?: TenantResolver;
  /** postgres-js client options applied to every created client. */
  clientOptions?: SqlClientOptions;
  /** Max cached SILO clients (LRU). The shared pool client is always retained. */
  maxSiloClients?: number;
  /** Injectable for tests; defaults to createSqlClient. */
  clientFactory?: ClientFactory;
}

/**
 * Default env-driven resolver — no network, fully backward compatible.
 *   TENANT_SILO_IDS         comma-separated tenant UUIDs on the silo tier
 *   TENANT_SILO_DSN_TEMPLATE DSN with a `{tenant}` placeholder, e.g.
 *     postgres://svc:pw@host:5432/civitas_tenant_{tenant}
 * Any tenant not listed → pool tier.
 */
export function envTenantResolver(): TenantResolver {
  const ids = new Set(
    (process.env.TENANT_SILO_IDS ?? "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  const template = process.env.TENANT_SILO_DSN_TEMPLATE ?? "";
  return (tenantId: string): TenantConnInfo => {
    if (ids.has(tenantId.toLowerCase()) && template) {
      return { tier: "silo", connectionString: template.replaceAll("{tenant}", tenantId) };
    }
    return { tier: "pool" };
  };
}

/**
 * Wrap any resolver with a small in-process TTL cache so the hot path doesn't
 * hit the registry/HTTP on every request. Compose around an HTTP/registry-backed
 * resolver: `cachedResolver(tenantServiceResolver, 30_000)`.
 */
export function cachedResolver(inner: TenantResolver, ttlMs = 30_000): TenantResolver {
  const cache = new Map<string, { info: TenantConnInfo; exp: number }>();
  return async (tenantId: string): Promise<TenantConnInfo> => {
    const now = Date.now();
    const hit = cache.get(tenantId);
    if (hit && hit.exp > now) return hit.info;
    const info = await inner(tenantId);
    cache.set(tenantId, { info, exp: now + ttlMs });
    return info;
  };
}

export class TenantRouter {
  private readonly poolDsn: string;
  private readonly resolver: TenantResolver;
  private readonly clientOptions: SqlClientOptions | undefined;
  private readonly maxSiloClients: number;
  private readonly factory: ClientFactory;

  private poolClient: SqlClient | undefined;
  /** dsn -> client, LRU-ordered by insertion/touch. */
  private readonly silo = new Map<string, SqlClient>();

  constructor(opts: TenantRouterOptions = {}) {
    this.poolDsn = opts.poolDsn ?? process.env.DATABASE_URL ?? "";
    this.resolver = opts.resolver ?? envTenantResolver();
    this.clientOptions = opts.clientOptions;
    this.maxSiloClients = opts.maxSiloClients ?? Number(process.env.TENANT_SILO_CLIENT_CACHE ?? 25);
    this.factory = opts.clientFactory ?? createSqlClient;
  }

  /** The shared pool-tier client (lazy). */
  private getPoolClient(): SqlClient {
    if (!this.poolClient) {
      if (!this.poolDsn) throw new Error("TenantRouter: no pool DSN (set DATABASE_URL or poolDsn)");
      this.poolClient = this.factory(this.poolDsn, this.clientOptions);
    }
    return this.poolClient;
  }

  private getSiloClient(dsn: string): SqlClient {
    const existing = this.silo.get(dsn);
    if (existing) {
      // LRU touch
      this.silo.delete(dsn);
      this.silo.set(dsn, existing);
      return existing;
    }
    const client = this.factory(dsn, this.clientOptions);
    this.silo.set(dsn, client);
    // Evict least-recently-used beyond the cap.
    while (this.silo.size > this.maxSiloClients) {
      const oldestKey = this.silo.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const evicted = this.silo.get(oldestKey);
      this.silo.delete(oldestKey);
      void evicted?.end({ timeout: 5 }).catch(() => undefined);
    }
    return client;
  }

  /** Resolve the postgres-js client for a tenant's tier. */
  async sqlFor(tenantId: string): Promise<SqlClient> {
    if (!TENANT_ID_RE.test(tenantId)) {
      throw new Error(`TenantRouter.sqlFor: invalid tenantId (must be a UUID): ${tenantId}`);
    }
    const info = await this.resolver(tenantId);
    if (info.tier === "silo") {
      if (!info.connectionString) {
        throw new Error(`TenantRouter: silo tenant ${tenantId} has no connectionString`);
      }
      return this.getSiloClient(info.connectionString);
    }
    return this.getPoolClient();
  }

  /** Tier of a tenant (for routing decisions / observability). */
  async tierOf(tenantId: string): Promise<TenantTier> {
    return (await this.resolver(tenantId)).tier;
  }

  /** Close all pooled clients (shutdown). */
  async end(): Promise<void> {
    const all = [this.poolClient, ...this.silo.values()].filter(Boolean) as SqlClient[];
    this.poolClient = undefined;
    this.silo.clear();
    await Promise.all(all.map((c) => c.end({ timeout: 5 }).catch(() => undefined)));
  }
}
