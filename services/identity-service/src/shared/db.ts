import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { usersModuleSchema } from "../modules/users/schema.js";
import { rbacModuleSchema } from "../modules/rbac/schema.js";
import { sessionsModuleSchema } from "../modules/sessions/schema.js";
import { mfaModuleSchema } from "../modules/mfa/schema.js";
import { apiKeysModuleSchema } from "../modules/apikeys/schema.js";
import { breakglassModuleSchema } from "../modules/breakglass/schema.js";
import { schema as devicesSyncSchema } from "../modules/devices/schema.js";
import { outboxSchema } from "./outbox.js";
import { kcReconcileSchema } from "./kc-reconcile.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://identity_svc:***@host/civitas_identity)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: { ...usersModuleSchema, ...rbacModuleSchema, ...sessionsModuleSchema, ...mfaModuleSchema, ...apiKeysModuleSchema, ...breakglassModuleSchema, ...devicesSyncSchema, ...outboxSchema, ...kcReconcileSchema },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;

/**
 * Run a READ inside the tenant transaction so PostgreSQL RLS is enforced on
 * the read path too. Plain db.select() runs on a pooled connection with no
 * app.tenant_id GUC set, so under a NOBYPASSRLS role (hrms_svc / identity_svc)
 * the fail-closed policy returns ZERO rows. Wrapping the read in db.transaction
 * makes wrapWithTenantGuc set the GUC from AsyncLocalStorage - reads are then
 * correctly tenant-scoped by RLS, not merely by an app-layer WHERE. Mirrors
 * court-service / visitor-service / meeting-service.
 */
type ScopedTx = Parameters<Parameters<typeof _rawDb.transaction>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn as Parameters<typeof db.transaction>[0]) as Promise<T>;
}
