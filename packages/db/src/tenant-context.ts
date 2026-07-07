/**
 * Tenant context via AsyncLocalStorage — enables automatic GUC propagation.
 *
 * PROBLEM: consumers and routes use bare `db.transaction()` without setting
 * app.tenant_id GUC. RLS policies are therefore inert at runtime.
 *
 * SOLUTION: Store the current tenantId in AsyncLocalStorage. The enhanced
 * `createTenantDb()` wraps Drizzle's db.transaction() to automatically call
 * `SET LOCAL app.tenant_id` at the start of every transaction when a tenant
 * context is active.
 *
 * USAGE (service shared/db.ts):
 *   import { createTenantDb, setTenantContext } from "@civitasone/db";
 *   export const db = createTenantDb(schema);
 *
 * The onRequest hook (createTenantTxHook) now also stores the tenantId in
 * AsyncLocalStorage, so ANY db.transaction() within that request automatically
 * gets the GUC set — even without explicitly using `req.tenantTx`.
 *
 * For consumers (workers): wrap the handler in `runWithTenant(tenantId, fn)`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantStore {
  tenantId: string;
}

/**
 * AsyncLocalStorage holding the current tenant context.
 * Available in request handlers (via hook) and consumers (via runWithTenant).
 */
export const tenantStorage = new AsyncLocalStorage<TenantStore>();

/**
 * Get the current tenantId from AsyncLocalStorage, or undefined if not set.
 */
export function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId;
}

/**
 * Run a function within a tenant context. The tenantId will be available
 * to any db.transaction() call within fn via getCurrentTenantId().
 *
 * Use in consumers/workers:
 *   await runWithTenant(msg.tenantId, async () => {
 *     await db.transaction(async (tx) => { ... }); // GUC auto-set
 *   });
 */
export function runWithTenant<T>(tenantId: string, fn: () => T | Promise<T>): T | Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

/**
 * Set tenant context for the current async scope (used by the onRequest hook).
 * Prefer runWithTenant for new code; this is for backward compat with the hook.
 */
export function setTenantContext(tenantId: string): void {
  const store = tenantStorage.getStore();
  if (store) {
    store.tenantId = tenantId;
  }
}
