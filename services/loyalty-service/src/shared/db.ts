/**
 * loyalty-service DB connection — TenantRouter adoption.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as programsModule } from "../modules/programs/schema.js";
import { schema as enrolmentsModule } from "../modules/enrolments/schema.js";
import { schema as accrualsModule } from "../modules/accruals/schema.js";
import { schema as redemptionsModule } from "../modules/redemptions/schema.js";
import { schema as tiersModule } from "../modules/tiers/schema.js";

const SCHEMA = {
  ...programsModule,
  ...enrolmentsModule,
  ...accrualsModule,
  ...redemptionsModule,
  ...tiersModule,
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
