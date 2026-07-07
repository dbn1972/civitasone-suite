import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createSqlClient, getCurrentTenantId } from "@civitasone/db";
import { schema as budgetModule }   from "../modules/budget/schema.js";
import { schema as glModule }       from "../modules/gl/schema.js";
import { schema as treasuryModule } from "../modules/treasury/schema.js";
import { schema as paymentsModule } from "../modules/payments/schema.js";
import { schema as auditModule }    from "../modules/audit/schema.js";
import { schema as periodCloseModule } from "../modules/period-close/schema.js";
import { schema as hoaModule }      from "../modules/hoa/schema.js";
import { schema as mastersModule }  from "../modules/masters/schema.js";
import { schema as bankReconModule } from "../modules/bank-recon/schema.js";
import { schema as simplifiedModule } from "../modules/simplified/schema.js";
import { schema as anomalyModule }    from "../modules/anomaly/schema.js";
import { allocationSchema } from "../modules/budget/allocation-schema.js";
import { outboxSchema }             from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://finance_svc:***@host/civitas_finance)");

export const sqlClient = createSqlClient(url);

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseDb = drizzle(sqlClient, {
  schema: { ...budgetModule, ...glModule, ...treasuryModule, ...paymentsModule, ...auditModule, ...periodCloseModule, ...hoaModule, ...mastersModule, ...bankReconModule, ...simplifiedModule, ...anomalyModule, ...allocationSchema, ...outboxSchema },
});

// C1 FIX: Wrap db.transaction() to auto-inject app.tenant_id GUC from
// AsyncLocalStorage context. This ensures RLS is enforced on EVERY transaction
// even when code uses bare db.transaction() (the 902 call site problem).
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
