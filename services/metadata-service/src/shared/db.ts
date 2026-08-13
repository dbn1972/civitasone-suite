import { createTenantDb, runWithTenant } from "@civitasone/db";
import { lookupsModuleSchema } from "../modules/lookups/schema.js";

// Note: the metadata service's DATABASE_URL points to civitas_works which contains
// the works domain tables and the metadata.* lookup/kv tables added for gap-closure.
// The entity_definitions etc. from entities/schema are in civitas_metadata (separate DB).
const SCHEMA = { ...lookupsModuleSchema };

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });
export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function readScoped<T>(tenantId: string, fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as (tx: ScopedTx) => Promise<T>),
  ) as Promise<T>;
}
