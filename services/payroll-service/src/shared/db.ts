import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createSqlClient, getCurrentTenantId } from "@civitasone/db";
import { schema as payrollModule }    from "../modules/payroll/schema.js";
import { schema as loansModule }      from "../modules/loans/schema.js";
import { schema as statutoryModule }  from "../modules/statutory/schema.js";
import { schema as integrationModule } from "../modules/integration/schema.js";
import { schema as taxModule }         from "../modules/tax/schema.js";
import { schema as sponsorConfigModule } from "../modules/sponsor-config/schema.js";
import { schema as nachReturnModule } from "../modules/nach-return/schema.js";
import { schema as dscConfigModule } from "../modules/dsc-config/schema.js";
import { outboxSchema }               from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://payroll_svc:***@host/civitas_payroll)");

export const sqlClient = createSqlClient(url);

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseDb = drizzle(sqlClient, {
  schema: { ...payrollModule, ...loansModule, ...statutoryModule, ...integrationModule, ...taxModule, ...sponsorConfigModule, ...nachReturnModule, ...dscConfigModule, ...outboxSchema },
});

// C1 FIX: Auto-inject app.tenant_id GUC on every transaction via AsyncLocalStorage.
const originalTransaction = baseDb.transaction.bind(baseDb);
export const db: typeof baseDb = Object.assign(Object.create(baseDb), {
  transaction: async <T>(fn: (tx: any) => Promise<T>, config?: any): Promise<T> => {
    const tenantId = getCurrentTenantId();
    if (tenantId && TENANT_ID_RE.test(tenantId)) {
      return originalTransaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
        return fn(tx);
      }, config);
    }
    return originalTransaction(fn, config);
  },
}) as typeof baseDb;

export type Db = typeof db;

/**
 * Run a READ inside the tenant transaction so PostgreSQL RLS is enforced on
 * the read path too. Plain `db.select()` runs on a pooled connection with no
 * `app.tenant_id` GUC set, so under a NOBYPASSRLS role the fail-closed policy
 * returns ZERO rows. Wrapping the read in `db.transaction` makes the wrapper
 * above set the GUC from AsyncLocalStorage — reads are then correctly
 * tenant-scoped by RLS, not merely by an app-layer WHERE.
 */
type ScopedTx = Parameters<Parameters<typeof baseDb.transaction>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn as Parameters<typeof db.transaction>[0]) as Promise<T>;
}
