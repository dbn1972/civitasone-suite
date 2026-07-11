import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createSqlClient, getCurrentTenantId } from "@civitasone/db";

/**
 * Drizzle client for meeting-service.
 *
 * All tables live in the `meeting` PostgreSQL schema (see modules/{module}/schema.ts,
 * which build on `pgSchema("meeting")`). Module schemas are merged into the Drizzle
 * schema map below as each module lands (meeting-core, committee, agenda, …). The
 * transactional-outbox schema is merged once shared/outbox.ts exists (task 1.3).
 *
 * Fail-fast: the service crashes at import time if DATABASE_URL is missing rather
 * than silently connecting to an unsafe default (steering: Environment & Config).
 *
 * Connection pool size is driven by DATABASE_POOL_SIZE (default 20) per the suite
 * performance budget (20 connections per service).
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required (postgres://meeting_svc:***@host/civitas_meeting)");
}

const poolMax = Number(process.env.DATABASE_POOL_SIZE ?? 20);

export const sqlClient = createSqlClient(url, { max: poolMax });

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Module schemas are registered here as modules are implemented. Kept as a single
// spread object so future modules add one line each without touching the wrapper.
const schema = {
  // ...meetingCoreModule, ...committeeModule, ...agendaModule, (added per module task)
  // ...outboxSchema, (added in task 1.3)
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


/**
 * The Drizzle transaction handle passed to {@link scopedRead}. Derived from the
 * underlying (pre-wrap) transaction so `tx.select()` keeps full column typing —
 * the public `db.transaction` is re-typed with `tx: any`, which would erase it.
 */
type ScopedTx = Parameters<Parameters<typeof baseDb.transaction>[0]>[0];

/**
 * Run a READ inside the tenant transaction so PostgreSQL RLS is enforced on
 * the read path too. Plain `db.select()` runs on a pooled connection with no
 * `app.tenant_id` GUC set, so under a NOBYPASSRLS role the fail-closed policy
 * returns ZERO rows. Wrapping the read in `db.transaction` makes the wrapper
 * (above) set the GUC from AsyncLocalStorage — reads are then correctly
 * tenant-scoped by RLS, not merely by an app-layer WHERE.
 */
export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
