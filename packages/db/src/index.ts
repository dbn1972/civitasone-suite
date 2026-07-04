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
// Phase 1 hyperscale: per-tenant quota enforcement plugin.
export { quotaCheckPlugin, type QuotaCheckStore, type QuotaCheckOptions, type TenantQuota } from "./quota-check.js";

// Re-export drizzle-orm helpers for convenience
export { sql, eq, and, or, not, asc, desc, inArray, isNull, isNotNull } from "drizzle-orm";
export { pgTable, text, varchar, integer, bigint, boolean, timestamp, jsonb, uuid, pgEnum } from "drizzle-orm/pg-core";
