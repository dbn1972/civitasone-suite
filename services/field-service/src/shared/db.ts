/**
 * field-service DB connection — TenantRouter adoption.
 * See packages/db/src/create-tenant-db.ts for the createTenantDb() contract.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as tasksModule } from "../modules/tasks/schema.js";
import { schema as visitsModule } from "../modules/visits/schema.js";
import { schema as routesModule } from "../modules/routes/schema.js";
import { schema as syncModule } from "../modules/sync/schema.js";

const SCHEMA = {
  ...tasksModule,
  ...visitsModule,
  ...routesModule,
  ...syncModule,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { ScopedTx };

export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
