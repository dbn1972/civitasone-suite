/**
 * crm-service DB connection.
 * Connects with the crm_svc role to the civitas_crm database ONLY (L1).
 * Drizzle is bound to this service's module schemas + the outbox schema.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as contactsModule } from "../modules/contacts/schema.js";
import { schema as dealsModule } from "../modules/deals/schema.js";
import { schema as activitiesModule } from "../modules/activities/schema.js";
import { schema as pipelinesModule } from "../modules/pipelines/schema.js";
import { schema as customFieldsModule } from "../modules/custom-fields/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://crm_svc:***@host/civitas_crm)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...contactsModule, ...dealsModule, ...activitiesModule, ...pipelinesModule, ...customFieldsModule, ...outboxSchema },
});

export type Db = typeof db;
