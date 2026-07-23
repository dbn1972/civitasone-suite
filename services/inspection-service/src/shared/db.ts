/**
 * inspection-service DB connection — TenantRouter adoption.
 * See packages/db/src/create-tenant-db.ts for the createTenantDb() contract.
 *
 * Module schemas are added here as they are implemented. The outbox schema is
 * always included since it underpins the transactional outbox pattern used by
 * every consumer.
 */
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
