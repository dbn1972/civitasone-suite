import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { templatesModuleSchema } from "../modules/templates/schema.js";
import { deliveriesModuleSchema } from "../modules/deliveries/schema.js";
import { channelsModuleSchema } from "../modules/channels/schema.js";
import { alertsModuleSchema } from "../modules/alerts/schema.js";
import { bulkModuleSchema } from "../modules/bulk/schema.js";
import { streamModuleSchema } from "../modules/stream/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://notification_svc:***@host/civitas_notification)");

export const sqlClient = createSqlClient(url);
const _rawDb = drizzle(sqlClient, {
  schema: {
    ...templatesModuleSchema,
    ...deliveriesModuleSchema,
    ...channelsModuleSchema,
    ...alertsModuleSchema,
    ...bulkModuleSchema,
    ...streamModuleSchema,
    ...outboxSchema,
  },
});
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
