import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as itemsModule } from "../modules/items/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://plugin_svc:***@host/civitas_plugin)");

export const sqlClient = createSqlClient(url);
const _rawDb = drizzle(sqlClient, { schema: { ...itemsModule, ...outboxSchema } });
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
