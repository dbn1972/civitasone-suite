/**
 * tenant-service DB connection.
 * Connects with the tenant_svc role to the civitas_tenant database ONLY (L1).
 * Drizzle is bound to this service's module schemas + the outbox schema.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as tenantModule } from "../modules/tenant/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://tenant_svc:***@host/civitas_tenant)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...tenantModule, ...outboxSchema },
});

export type Db = typeof db;
