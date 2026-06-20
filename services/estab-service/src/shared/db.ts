import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as filesModule }      from "../modules/files/schema.js";
import { schema as committeeModule }  from "../modules/committee/schema.js";
import { schema as assetsModule }     from "../modules/assets/schema.js";
import { schema as facilitiesModule } from "../modules/facilities/schema.js";
import { schema as legalModule }      from "../modules/legal/schema.js";
import { outboxSchema }               from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://estab_svc:***@host/civitas_estab)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...filesModule, ...committeeModule, ...assetsModule, ...facilitiesModule, ...legalModule, ...outboxSchema },
});

export type Db = typeof db;
