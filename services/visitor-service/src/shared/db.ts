import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { outboxSchema } from "./outbox.js";
import { schema as checkInModule } from "../modules/check-in/schema.js";
import { schema as digitalPassModule } from "../modules/digital-pass/schema.js";
import { schema as visitRequestModule } from "../modules/visit-request/schema.js";
import { schema as locationModule } from "../modules/location/schema.js";
import { schema as dpdpModule } from "../modules/dpdp/schema.js";
import { blacklistEntries, watchlistEntries } from "../modules/blacklist/schema.js";
import { schema as analyticsModule } from "../modules/analytics/schema.js";

// NOTE: remaining modules' schema.ts files are merged in as their
// consumers/routes are scaffolded (see tasks 3+). check-in, digital-pass,
// visit-request, location, and blacklist are wired here to support
// modules/check-in/consumer.ts (Task 16.1/9.10), modules/location/repo.ts
// (Task 3.4), and modules/blacklist/consumer.ts (Task 4.6).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://visitor_svc:***@host/civitas_visitor)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: {
    ...checkInModule,
    ...digitalPassModule,
    ...visitRequestModule,
    ...locationModule,
    ...dpdpModule,
    ...analyticsModule,
    blacklistEntries,
    watchlistEntries,
    ...outboxSchema,
  },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;

/**
 * Run a READ inside the tenant transaction so PostgreSQL RLS is enforced on
 * the read path too. Plain db.select() runs on a pooled connection with no
 * app.tenant_id GUC set, so under a NOBYPASSRLS role (e.g. visitor_svc) the
 * fail-closed policy returns ZERO rows. Wrapping the read in db.transaction
 * makes wrapWithTenantGuc set the GUC from AsyncLocalStorage - reads are then
 * correctly tenant-scoped by RLS, not merely by an app-layer WHERE. Mirrors
 * court-service / meeting-service (commit 904c302).
 */
type ScopedTx = Parameters<Parameters<typeof _rawDb.transaction>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn as Parameters<typeof db.transaction>[0]) as Promise<T>;
}
