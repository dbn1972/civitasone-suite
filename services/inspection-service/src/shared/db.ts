/**
 * inspection-service DB connection — TenantRouter adoption.
 * See packages/db/src/create-tenant-db.ts for the createTenantDb() contract.
 *
 * Module schemas are added here as they are implemented. The outbox schema is
 * always included since it underpins the transactional outbox pattern used by
 * every consumer.
 */
import { sql } from "drizzle-orm";
import { createTenantDb } from "@civitasone/db";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

/**
 * Run a READ inside a transaction so PostgreSQL RLS is enforced on the read
 * path. Plain `db.select()` runs on a pooled connection with no `app.tenant_id`
 * GUC set, so RLS fail-closed policies return ZERO rows. Wrapping in
 * `db.transaction()` lets createTenantDb's wrapWithTenantGuc set the GUC from
 * AsyncLocalStorage when a tenant context is active.
 */
type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return db.transaction(fn as (tx: ScopedTx) => Promise<T>);
}

/**
 * Run a genuinely cross-tenant SELECT (the overdue-findings sweep, which must
 * find candidate TENANT IDS across ALL tenants, not one) with the
 * `app.platform_bypass` GUC set for the transaction, per the additional
 * permissive SELECT-only RLS policy in migration 0021_platform_bypass_read_policy.sql.
 *
 * SECURITY: this must ONLY be called from trusted server-side code with no
 * user-supplied input — never derived from a request header/param/JWT claim.
 * It is SELECT-only by policy design: INSERT/UPDATE/DELETE on the underlying
 * tables remain governed solely by the strict tenant-match policy, so this
 * can never let a write skip tenant scoping.
 *
 * Root cause this exists for: processOverdueFindings (worker.ts) is a
 * system-scheduled job with no per-request tenant context at all — a bare
 * db.execute()/db.transaction() sets no GUC, so `tenant_id = current_tenant_id()`
 * never matches (current_tenant_id() is NULL), and the sweep silently found
 * zero candidate tenants in every environment since it was introduced.
 * Mirrors admin-service's migration 0011 / audit-service's migration 0021
 * scopedPlatformRead pattern exactly.
 */
export function scopedPlatformRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`SELECT set_config('app.platform_bypass', 'true', true)`,
    );
    return fn(tx);
  }) as Promise<T>;
}
