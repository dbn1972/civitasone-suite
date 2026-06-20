import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as stagesModule } from "../modules/stages/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://install_svc:***@host/civitas_install)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, { schema: { ...stagesModule, ...outboxSchema } });
export type Db = typeof db;
