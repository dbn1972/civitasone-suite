/**
 * report-service DB connection.
 * Connects with the report_svc role to the civitas_report database ONLY (L1).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as jobsModule } from "../modules/jobs/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://report_svc:***@host/civitas_report)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...jobsModule, ...outboxSchema },
});

export type Db = typeof db;
