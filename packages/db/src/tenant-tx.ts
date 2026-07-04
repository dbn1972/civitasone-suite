/**
 * Tenant-scoped transaction factory — auto-sets app.tenant_id GUC.
 *
 * Use this as a drop-in replacement for db.transaction() in services.
 * Wraps the transaction so RLS policies see the correct tenant.
 *
 * Usage:
 *   import { tenantTransaction } from "@civitasone/db";
 *
 *   await tenantTransaction(db, ctx.tenantId, async (tx) => {
 *     await tx.insert(table).values({ ... });
 *   });
 *
 * This is equivalent to withTenantScope but with a simpler API that matches
 * the common db.transaction() pattern used across all services.
 */
import { setTenantGuc } from "./tenant-scope.js";

type DrizzleDb = {
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};

/**
 * Run fn inside a transaction with app.tenant_id GUC set (transaction-local).
 * RLS policies will enforce tenant isolation as a defense-in-depth backstop.
 */
export async function tenantTransaction<T>(
  db: DrizzleDb,
  tenantId: string,
  fn: (tx: unknown) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const runner = tx as { execute: (q: unknown) => Promise<unknown> };
    await setTenantGuc(runner, tenantId);
    return fn(tx);
  });
}

/**
 * Fastify onRequest hook factory — sets up a per-request db helper.
 * Services can register this hook to make req.tenantTx available.
 *
 * Usage in app.ts:
 *   app.decorateRequest("tenantTx", null);
 *   app.addHook("onRequest", createTenantTxHook(db));
 *
 * Then in routes:
 *   const tx = await req.tenantTx(async (tx) => { ... });
 */
export function createTenantTxHook(db: DrizzleDb) {
  return async function tenantTxHook(req: { headers: Record<string, string | string[] | undefined> }) {
    const tenantId = req.headers["x-tenant-id"] as string | undefined;
    (req as unknown as { tenantTx: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }).tenantTx =
      tenantId
        ? <T>(fn: (tx: unknown) => Promise<T>) => tenantTransaction(db, tenantId, fn)
        : <T>(fn: (tx: unknown) => Promise<T>) => db.transaction(fn);
  };
}
