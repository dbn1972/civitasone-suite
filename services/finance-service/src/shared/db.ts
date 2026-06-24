import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as budgetModule }   from "../modules/budget/schema.js";
import { schema as glModule }       from "../modules/gl/schema.js";
import { schema as treasuryModule } from "../modules/treasury/schema.js";
import { schema as paymentsModule } from "../modules/payments/schema.js";
import { schema as auditModule }    from "../modules/audit/schema.js";
import { schema as periodCloseModule } from "../modules/period-close/schema.js";
import { schema as hoaModule }      from "../modules/hoa/schema.js";
import { schema as mastersModule }  from "../modules/masters/schema.js";
import { outboxSchema }             from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://finance_svc:***@host/civitas_finance)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...budgetModule, ...glModule, ...treasuryModule, ...paymentsModule, ...auditModule, ...periodCloseModule, ...hoaModule, ...mastersModule, ...outboxSchema },
});

export type Db = typeof db;
