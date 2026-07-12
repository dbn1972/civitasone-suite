/**
 * @civitasone/db
 * Drizzle ORM base configuration and shared DB utilities.
 * Rule (Vol 3): every service has its own schema. This package provides
 * the base connection helper and base column definitions only.
 * Services import from here to build their own schemas — never share tables.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createSqlClient } from "./pool.js";

/** Call once at service startup. Pass your service's schema. */
export function createDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
  connectionString?: string
) {
  const client = createSqlClient(connectionString);
  return drizzle(client, { schema });
}

export { createSqlClient } from "./pool.js";
export {
  TenantRouter,
  envTenantResolver,
  envShardResolver,
  cachedResolver,
  type TenantTier,
  type TenantConnInfo,
  type TenantResolver,
  type TenantRouterOptions,
} from "./tenant-router.js";
export { assertP95, measureP95, assertIndexUsed } from "./perf.js";
// SAST-003: RLS defense-in-depth — tenant GUC helpers (staged rollout; see tenant-scope.ts).
export { withTenantScope, setTenantGuc } from "./tenant-scope.js";
// SAST-003b: simplified tenant-scoped transaction factory.
export { tenantTransaction, createTenantTxHook } from "./tenant-tx.js";
// SAST-003c: AsyncLocalStorage tenant context for automatic GUC propagation.
export { tenantStorage, getCurrentTenantId, runWithTenant, setTenantContext } from "./tenant-context.js";
// SAST-003d: Tenant-aware DB wrapper — auto-sets GUC on every transaction.
export { createTenantDb as createTenantDbWithGuc } from "./tenant-db.js";
// Fleet-wide TenantRouter-adoption factory (Req 1.1–1.6) — generalizes the
// estab-service pattern: { sqlClient, db, router, sqlClientFor, dbFor, tierOf }.
export {
  createTenantDb,
  type TenantDb,
  type TenantDbOptions,
} from "./create-tenant-db.js";
// SAST-003e: Consumer handler wrapper for tenant context propagation.
export { withTenantConsumer } from "./tenant-consumer.js";
// SAST-003f: One-line db wrapper for tenant GUC injection.
export { wrapWithTenantGuc } from "./wrap-tenant-db.js";
// Phase 1 hyperscale: per-tenant quota enforcement plugin.
export { quotaCheckPlugin, type QuotaCheckStore, type QuotaCheckOptions, type TenantQuota } from "./quota-check.js";

// Re-export drizzle-orm helpers for convenience
export { sql, eq, and, or, not, asc, desc, inArray, isNull, isNotNull } from "drizzle-orm";
export { pgTable, text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid, pgEnum } from "drizzle-orm/pg-core";
