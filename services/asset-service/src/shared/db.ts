import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as registerModule }     from "../modules/register/schema.js";
import { schema as lifecycleModule }    from "../modules/lifecycle/schema.js";
import { schema as depModule }          from "../modules/depreciation/schema.js";
import { schema as maintenanceModule }  from "../modules/maintenance/schema.js";
import { schema as insuranceModule }    from "../modules/insurance/schema.js";
import { outboxSchema }                 from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://asset_svc:***@host/civitas_asset)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...registerModule, ...lifecycleModule, ...depModule, ...maintenanceModule, ...insuranceModule, ...outboxSchema },
});

export type Db = typeof db;
