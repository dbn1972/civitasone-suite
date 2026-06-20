import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as itemsModule } from "../modules/items/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://plugin_svc:***@host/civitas_plugin)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, { schema: { ...itemsModule, ...outboxSchema } });
export type Db = typeof db;
