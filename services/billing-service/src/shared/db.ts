import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as plansModule } from "../modules/plans/schema.js";
import { schema as subscriptionsModule } from "../modules/subscriptions/schema.js";
import { schema as usageModule } from "../modules/usage/schema.js";
import { schema as invoicesModule } from "../modules/invoices/schema.js";
import { schema as paymentsModule } from "../modules/payments/schema.js";
import { schema as einvoiceModule } from "../modules/einvoice/schema.js";
import { schema as revenueModule } from "../modules/revenue/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://billing_svc:***@host/civitas_billing)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, {
  schema: { ...plansModule, ...subscriptionsModule, ...usageModule, ...invoicesModule, ...paymentsModule, ...einvoiceModule, ...revenueModule, ...outboxSchema },
});
export type Db = typeof db;
