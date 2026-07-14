/**
 * Tenant-aware Drizzle DB wrapper.
 *
 * Wraps the standard Drizzle `db` instance so that every call to
 * db.transaction() automatically sets `app.tenant_id` GUC when a tenant
 * context exists (via AsyncLocalStorage).
 *
 * This ensures RLS policies are enforced even when code uses bare
 * `db.transaction()` — eliminating the 902 bare db.* call site problem.
 *
 * NOTE: re-exported from `./index.js` as `createTenantDbWithGuc` to avoid a
 * name collision with the fleet-wide TenantRouter-adoption factory in
 * `./create-tenant-db.js` (also named `createTenantDb`).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createSqlClient } from "./pool.js";
import { getCurrentTenantId } from "./tenant-context.js";

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create a Drizzle DB instance with automatic tenant GUC injection.
 *
 * Every transaction will call `SET LOCAL app.tenant_id = <uuid>` before
 * executing the user's transaction function, IF a tenantId is available
 * in the current AsyncLocalStorage context.
 *
 * Usage:
 *   export const db = createTenantDb(schema);
 *   // or with explicit connection string:
 *   export const db = createTenantDb(schema, process.env.DATABASE_URL);
 */
export function createTenantDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
  connectionString?: string,
) {
  const client = createSqlClient(connectionString);
  const baseDb = drizzle(client, { schema });

  // Wrap transaction to auto-inject GUC
  const originalTransaction = baseDb.transaction.bind(baseDb);

  const wrappedDb = Object.create(baseDb) as typeof baseDb;

  wrappedDb.transaction = async function tenantAwareTransaction<T>(
    fn: (tx: Parameters<typeof originalTransaction>[0] extends (tx: infer Tx) => unknown ? Tx : never) => Promise<T>,
    config?: unknown,
  ): Promise<T> {
    const tenantId = getCurrentTenantId();

    if (tenantId && TENANT_ID_RE.test(tenantId)) {
      // Inject GUC set at the start of the transaction
      return originalTransaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
        return fn(tx);
      }, config as any);
    }

    // No tenant context — pass through (platform operations, migrations, etc.)
    return originalTransaction(fn as any, config as any);
  } as any;

  return wrappedDb;
}

/**
 * Create the raw SQL client for use outside Drizzle (sqlClient for migrations, raw queries).
 * Re-exported for convenience.
 */
export { createSqlClient } from "./pool.js";
