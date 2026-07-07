import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as ticketsModule } from "../modules/tickets/schema.js";
import { schema as automationModule } from "../modules/automation/schema.js";
import { schema as slaModule } from "../modules/sla/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://helpdesk_svc:***@host/civitas_helpdesk)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: { ...ticketsModule, ...automationModule, ...slaModule, ...outboxSchema },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
