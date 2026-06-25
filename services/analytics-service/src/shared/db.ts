import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as dashboardsModule } from "../modules/dashboards/schema.js";
import { schema as queriesModule } from "../modules/queries/schema.js";
import { schema as metricsModule } from "../modules/metrics/schema.js";
import { schema as factsModule } from "../modules/facts/schema.js";
import { outboxSchema } from "./outbox.js";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://analytics_svc:***@host/civitas_analytics)");
export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, {
  schema: { ...dashboardsModule, ...queriesModule, ...metricsModule, ...factsModule, ...outboxSchema },
});
export type Db = typeof db;
