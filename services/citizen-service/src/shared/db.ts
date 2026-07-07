import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createSqlClient, getCurrentTenantId } from "@civitasone/db";
import { schema as portalModule }      from "../modules/portal/schema.js";
import { schema as applicationModule } from "../modules/application/schema.js";
import { schema as grievanceModule }   from "../modules/grievance/schema.js";
import { schema as rtiModule }         from "../modules/rti/schema.js";
import { schema as helpdeskModule }    from "../modules/helpdesk/schema.js";
import { schema as analyticsModule }   from "../modules/analytics/schema.js";
import { schema as slaRulesModule }    from "../modules/sla-rules/schema.js";
import { outboxSchema }                from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://citizen_svc:***@host/civitas_citizen)");

export const sqlClient = createSqlClient(url);

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseDb = drizzle(sqlClient, {
  schema: {
    ...portalModule,
    ...applicationModule,
    ...grievanceModule,
    ...rtiModule,
    ...helpdeskModule,
    ...analyticsModule,
    ...slaRulesModule,
    ...outboxSchema,
  },
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
