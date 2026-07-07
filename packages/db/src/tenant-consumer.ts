/**
 * Tenant-aware consumer wrapper — ensures the tenant context is active
 * for the duration of a queue message handler execution.
 *
 * USAGE (in service workers/consumers):
 *   import { withTenantConsumer } from "@civitasone/db";
 *
 *   queue.subscribe(COMMANDS.billCreate, withTenantConsumer(async (msg) => {
 *     // db.transaction() here will auto-set app.tenant_id GUC
 *     await db.transaction(async (tx) => { ... });
 *   }));
 *
 * This wraps the handler so that `getCurrentTenantId()` returns msg.tenantId
 * for the duration of the handler, enabling the tenant-aware db wrapper to
 * set the GUC automatically.
 */
import { runWithTenant } from "./tenant-context.js";

type CommandEnvelope = {
  tenantId: string;
  [key: string]: unknown;
};

type Handler<T = unknown> = (msg: T & CommandEnvelope) => Promise<void>;

/**
 * Wrap a queue consumer handler so it runs within a tenant context.
 * Any db.transaction() call inside the handler will automatically get
 * the app.tenant_id GUC set.
 */
export function withTenantConsumer<T>(handler: Handler<T>): Handler<T> {
  return async (msg: T & CommandEnvelope) => {
    if (msg.tenantId) {
      return runWithTenant(msg.tenantId, () => handler(msg)) as Promise<void>;
    }
    return handler(msg);
  };
}
