/**
 * wrapWithTenantGuc — wraps any Drizzle db instance so that every
 * db.transaction() call automatically sets app.tenant_id GUC from
 * AsyncLocalStorage context.
 *
 * Usage in service shared/db.ts:
 *   import { wrapWithTenantGuc } from "@civitasone/db";
 *   const rawDb = drizzle(sqlClient, { schema: ... });
 *   export const db = wrapWithTenantGuc(rawDb);
 *
 * This is the single-line fix for the W1.0/C1 "RLS inert at runtime" problem.
 */
import { sql } from "drizzle-orm";
import { getCurrentTenantId } from "./tenant-context.js";

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wrap a Drizzle db instance so transaction() auto-injects the tenant GUC.
 * Returns the same db reference with transaction() overridden.
 */
export function wrapWithTenantGuc<T extends { transaction: (...args: any[]) => any }>(db: T): T {
  const originalTransaction = db.transaction.bind(db);

  const wrapped = Object.create(db) as T;
  (wrapped as any).transaction = async <R>(fn: (tx: any) => Promise<R>, config?: any): Promise<R> => {
    const tenantId = getCurrentTenantId();
    if (tenantId && TENANT_ID_RE.test(tenantId)) {
      return originalTransaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
        return fn(tx);
      }, config);
    }
    return originalTransaction(fn, config);
  };

  return wrapped;
}
