import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as payrollModule }    from "../modules/payroll/schema.js";
import { schema as loansModule }      from "../modules/loans/schema.js";
import { schema as statutoryModule }  from "../modules/statutory/schema.js";
import { schema as integrationModule } from "../modules/integration/schema.js";
import { schema as taxModule }         from "../modules/tax/schema.js";
import { outboxSchema }               from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://payroll_svc:***@host/civitas_payroll)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...payrollModule, ...loansModule, ...statutoryModule, ...integrationModule, ...taxModule, ...outboxSchema },
});

export type Db = typeof db;
