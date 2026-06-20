import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { eventsModuleSchema } from "../modules/events/schema.js";
import { exportsModuleSchema } from "../modules/exports/schema.js";
import { schema as planModule } from "../modules/plan/schema.js";
import { schema as observationModule } from "../modules/observation/schema.js";
import { schema as paraModule } from "../modules/para/schema.js";
import { schema as complianceModule } from "../modules/compliance/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://audit_svc:***@host/civitas_audit)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, {
  schema: { ...eventsModuleSchema, ...exportsModuleSchema, ...planModule, ...observationModule, ...paraModule, ...complianceModule, ...outboxSchema },
});
export type Db = typeof db;
