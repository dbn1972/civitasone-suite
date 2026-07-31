/**
 * recommendation-service DB connection — TenantRouter adoption.
 * See packages/db/src/create-tenant-db.ts for the createTenantDb() contract.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as nbaModule } from "../modules/nba/schema.js";
import { schema as matrixModule } from "../modules/matrix/schema.js";
import { schema as healthModule } from "../modules/health/schema.js";
import { schema as feedbackModule } from "../modules/feedback/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...nbaModule,
  ...matrixModule,
  ...healthModule,
  ...feedbackModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { ScopedTx };

/**
 * Run a READ inside a tenant transaction so PostgreSQL RLS is enforced.
 */
export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
