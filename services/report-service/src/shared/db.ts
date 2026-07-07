/**
 * report-service DB connection.
 * Connects with the report_svc role to the civitas_report database ONLY (L1).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as jobsModule } from "../modules/jobs/schema.js";
import { schema as kpisModule } from "../modules/kpis/schema.js";
import { schema as templatesModule } from "../modules/templates/schema.js";
import { scheduledReportsSchema } from "../modules/scheduled/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://report_svc:***@host/civitas_report)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: { ...jobsModule, ...kpisModule, ...templatesModule, ...scheduledReportsSchema, ...outboxSchema },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
