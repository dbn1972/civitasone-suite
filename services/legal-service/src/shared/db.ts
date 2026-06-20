import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as casesModule } from "../modules/cases/schema.js";
import { schema as hearingsModule } from "../modules/hearings/schema.js";
import { schema as noticesModule } from "../modules/notices/schema.js";
import { schema as contractsModule } from "../modules/contracts/schema.js";
import { schema as settlementsModule } from "../modules/settlements/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://legal_svc:***@host/civitas_legal)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, {
  schema: { ...casesModule, ...hearingsModule, ...noticesModule, ...contractsModule, ...settlementsModule, ...outboxSchema },
});
export type Db = typeof db;
