import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
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
const _rawDb = drizzle(sqlClient, {
  schema: { ...plansModule, ...subscriptionsModule, ...usageModule, ...invoicesModule, ...paymentsModule, ...einvoiceModule, ...revenueModule, ...outboxSchema },
});
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;

/**
 * Run a READ inside the tenant transaction so PostgreSQL RLS is enforced on
 * the read path too. Plain `db.select()` runs on a pooled connection with no
 * `app.tenant_id` GUC set, so under a NOBYPASSRLS role the fail-closed policy
 * returns ZERO rows. Wrapping the read in `db.transaction` makes the wrapper
 * set the GUC from AsyncLocalStorage -- reads are then correctly tenant-scoped
 * by RLS, not merely by an app-layer WHERE.
 */
type ScopedTx = Parameters<Parameters<typeof _rawDb.transaction>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return db.transaction(fn as (tx: ScopedTx) => Promise<T>);
}
