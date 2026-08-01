/**
 * catalogue-service DB connection — TenantRouter adoption.
 * See packages/db/src/create-tenant-db.ts for the createTenantDb() contract.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as productsModule } from "../modules/products/schema.js";
import { schema as ratesModule } from "../modules/rates/schema.js";
import { schema as eligibilityModule } from "../modules/eligibility/schema.js";
import { schema as bundlesModule } from "../modules/bundles/schema.js";
import { governanceSchema } from "../modules/products/governance-schema.js";
import { schema as priceBooksModule } from "../modules/price-books/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...productsModule,
  ...ratesModule,
  ...eligibilityModule,
  ...bundlesModule,
  ...governanceSchema,
  ...priceBooksModule,
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
