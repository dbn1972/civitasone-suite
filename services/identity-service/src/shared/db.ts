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
