import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as portalModule }      from "../modules/portal/schema.js";
import { schema as applicationModule } from "../modules/application/schema.js";
import { schema as grievanceModule }   from "../modules/grievance/schema.js";
import { schema as rtiModule }         from "../modules/rti/schema.js";
import { schema as helpdeskModule }    from "../modules/helpdesk/schema.js";
import { schema as analyticsModule }   from "../modules/analytics/schema.js";
import { outboxSchema }                from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://citizen_svc:***@host/civitas_citizen)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: {
    ...portalModule,
    ...applicationModule,
    ...grievanceModule,
    ...rtiModule,
    ...helpdeskModule,
    ...analyticsModule,
    ...outboxSchema,
  },
});

export type Db = typeof db;
