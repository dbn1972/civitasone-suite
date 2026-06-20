import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as tenantsModule } from "../modules/tenants/schema.js";
import { schema as configModule } from "../modules/config/schema.js";
import { schema as healthModule } from "../modules/health/schema.js";
import { schema as backupModule } from "../modules/backup/schema.js";
import { schema as supportModule } from "../modules/support/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://admin_svc:***@host/civitas_admin)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, {
  schema: { ...tenantsModule, ...configModule, ...healthModule, ...backupModule, ...supportModule, ...outboxSchema },
});
export type Db = typeof db;
