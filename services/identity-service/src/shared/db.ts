import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { usersModuleSchema } from "../modules/users/schema.js";
import { rbacModuleSchema } from "../modules/rbac/schema.js";
import { sessionsModuleSchema } from "../modules/sessions/schema.js";
import { mfaModuleSchema } from "../modules/mfa/schema.js";
import { schema as devicesSyncSchema } from "../modules/devices/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://identity_svc:***@host/civitas_identity)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...usersModuleSchema, ...rbacModuleSchema, ...sessionsModuleSchema, ...mfaModuleSchema, ...devicesSyncSchema, ...outboxSchema },
});

export type Db = typeof db;
