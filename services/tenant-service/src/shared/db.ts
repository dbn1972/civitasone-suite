import { createTenantDb, runWithTenant } from "@civitasone/db";
import { schemaAll as tenantModule } from "../modules/tenant/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = { ...tenantModule, ...outboxSchema };

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function readScoped<T>(tenantId: string, fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as (tx: ScopedTx) => Promise<T>),
  ) as Promise<T>;
}
