import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as dashboardsModule } from "../modules/dashboards/schema.js";
import { schema as queriesModule } from "../modules/queries/schema.js";
import { schema as metricsModule } from "../modules/metrics/schema.js";
import { schema as factsModule } from "../modules/facts/schema.js";
import { schema as exportsModule } from "../modules/exports/schema.js";
import { scheduledExportsSchema } from "../modules/exports/scheduled-schema.js";
import { outboxSchema } from "./outbox.js";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://analytics_svc:***@host/civitas_analytics)");
export const sqlClient = createSqlClient(url);
const _rawDb = drizzle(sqlClient, {
  schema: { ...dashboardsModule, ...queriesModule, ...metricsModule, ...factsModule, ...exportsModule, ...scheduledExportsSchema, ...outboxSchema },
});
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
