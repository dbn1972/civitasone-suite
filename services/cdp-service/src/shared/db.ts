/**
 * cdp-service DB connection — TenantRouter adoption.
 * See packages/db/src/create-tenant-db.ts for the createTenantDb() contract.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as profilesModule } from "../modules/profiles/schema.js";
import { schema as identityModule } from "../modules/identity/schema.js";
import { schema as eventsModule } from "../modules/events/schema.js";
import { schema as segmentsModule } from "../modules/segments/schema.js";
import { schema as stewardModule } from "../modules/steward/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...profilesModule,
  ...identityModule,
  ...eventsModule,
  ...segmentsModule,
  ...stewardModule,
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
