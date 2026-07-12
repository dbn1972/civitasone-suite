import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { templatesModuleSchema } from "../modules/templates/schema.js";
import { deliveriesModuleSchema } from "../modules/deliveries/schema.js";
import { channelsModuleSchema } from "../modules/channels/schema.js";
import { alertsModuleSchema } from "../modules/alerts/schema.js";
import { bulkModuleSchema } from "../modules/bulk/schema.js";
import { streamModuleSchema } from "../modules/stream/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://notification_svc:***@host/civitas_notification)");

export const sqlClient = createSqlClient(url);
const _rawDb = drizzle(sqlClient, {
  schema: {
    ...templatesModuleSchema,
    ...deliveriesModuleSchema,
    ...channelsModuleSchema,
    ...alertsModuleSchema,
    ...bulkModuleSchema,
    ...streamModuleSchema,
    ...outboxSchema,
  },
});
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;


/**
 * Run a READ inside the tenant transaction so PostgreSQL RLS is enforced on
 * the read path too. Plain `db.select()` runs on a pooled connection with no
 * `app.tenant_id` GUC set, so under a NOBYPASSRLS role the fail-closed policy
 * returns ZERO rows. Wrapping the read in `db.transaction` makes the wrapper
 * set the GUC from AsyncLocalStorage -- reads are then correctly tenant-scoped
 * by RLS, not merely by an app-layer WHERE.
 */
type ScopedTx = Parameters<Parameters<typeof _rawDb.transaction>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  // Runtime is identical to `db.transaction(fn)`; the typed `tx` param lets
  // drizzle row types flow back to callers with no per-callsite annotations.
  return db.transaction(fn as (tx: ScopedTx) => Promise<T>);
}
