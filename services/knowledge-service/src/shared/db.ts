/**
 * knowledge-service DB connection.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as documentsModule } from "../modules/documents/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://knowledge_svc:***@host/civitas_knowledge)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: { ...documentsModule, ...outboxSchema },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
