import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as instancesModule } from "../modules/instances/schema.js";
import { schema as tasksModule } from "../modules/tasks/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://workflow_svc:***@host/civitas_workflow)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, {
  schema: { ...instancesModule, ...tasksModule, ...outboxSchema },
});
export type Db = typeof db;
