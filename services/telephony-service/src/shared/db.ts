/**
 * telephony-service DB connection.
 * Connects with the telephony_svc role to the civitas_telephony database ONLY (L1).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as callsModule } from "../modules/calls/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://telephony_svc:***@host/civitas_telephony)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...callsModule, ...outboxSchema },
});

export type Db = typeof db;
