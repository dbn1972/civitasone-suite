import { createTenantDb, runWithTenant } from "@civitasone/db";
import { schema as entitiesSchema } from "../modules/entities/schema.js";
import { lookupsModuleSchema } from "../modules/lookups/schema.js";

const SCHEMA = { ...entitiesSchema, ...lookupsModuleSchema };

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });
export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function readScoped<T>(tenantId: string, fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as (tx: ScopedTx) => Promise<T>),
  ) as Promise<T>;
}
