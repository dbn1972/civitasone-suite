import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createSqlClient, getCurrentTenantId } from "@civitasone/db";
import { caseRegistrySchema } from "../modules/case-registry/schema.js";
import { courtRegistrySchema } from "../modules/court-registry/schema.js";
import { hearingSchema } from "../modules/hearing/schema.js";
import { filingSchema } from "../modules/filing/schema.js";
import { orderSchema } from "../modules/order/schema.js";
import { causeListSchema } from "../modules/cause-list/schema.js";
import { scrutinySchema } from "../modules/scrutiny/schema.js";
import { noticeSchema } from "../modules/notice/schema.js";
import { complianceSchema } from "../modules/compliance/schema.js";
import { appealSchema } from "../modules/appeal/schema.js";
import { outboxSchema } from "./outbox.js";

/**
 * Drizzle client for court-service.
 *
 * All tables live in the `court` PostgreSQL schema (see modules/{module}/schema.ts,
 * which build on `pgSchema("court")`). Module schemas are merged into the Drizzle
 * schema map below as each module lands (case-registry, court-registry, cause-list,
 * hearing, order, filing). The transactional-outbox schema is merged via
 * shared/outbox.ts.
 *
 * Fail-fast: the service crashes at import time if DATABASE_URL is missing rather
 * than silently connecting to an unsafe default (steering: Environment & Config).
 *
 * Connection pool size is driven by DATABASE_POOL_SIZE (default 20) per the suite
 * performance budget (20 connections per service).
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required (postgres://court_svc:***@host/civitas_court)");
}

const poolMax = Number(process.env.DATABASE_POOL_SIZE ?? 20);

export const sqlClient = createSqlClient(url, { max: poolMax });

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Module schemas are registered here as modules are implemented. Kept as a single
// spread object so future modules add one line each without touching the wrapper.
const schema = {
  ...caseRegistrySchema,
  ...courtRegistrySchema,
  ...hearingSchema,
  ...filingSchema,
  ...orderSchema,
  ...causeListSchema,
  ...scrutinySchema,
  ...noticeSchema,
  ...complianceSchema,
  ...appealSchema,
  ...outboxSchema,
  // ...courtRegistrySchema, ...causeListSchema, ...hearingSchema, (added per module task)
};

const baseDb = drizzle(sqlClient, { schema });

// Auto-inject the app.tenant_id GUC on EVERY transaction via AsyncLocalStorage so
// PostgreSQL RLS is enforced even for bare db.transaction() call sites. Mirrors the
// established pattern in sibling services (finance, citizen, …).
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
