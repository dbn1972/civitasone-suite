/**
 * knowledge-service DB connection.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as documentsModule } from "../modules/documents/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://knowledge_svc:***@host/civitas_knowledge)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...documentsModule, ...outboxSchema },
});

export type Db = typeof db;
