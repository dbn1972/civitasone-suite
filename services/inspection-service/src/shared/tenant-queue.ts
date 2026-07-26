/**
 * tenantScoped — wrap a Queue so every subscribed command handler runs inside
 * the message's tenant context (AsyncLocalStorage via runWithTenant).
 *
 * WHY: inspection domain schemas (universe, risk, planning, assignment,
 * checklist, sync, evidence, execution, findings, …) have row-level security
 * whose policy is `tenant_id = <schema>.current_tenant_id()`, sourced from the
 * `app.tenant_id` GUC. The inspection DB roles are NOBYPASSRLS, so RLS applies.
 * The shared `db` (wrapWithTenantGuc) only sets `app.tenant_id` inside
 * `db.transaction()` when a tenant context is active. These consumers call
 * `db.transaction()` directly, so without establishing the context first EVERY
 * insert/update is rejected by RLS ("new row violates row-level security
 * policy") and every read returns zero rows. This mirrors the telephony- and
 * visitor-service fixes; we apply it at consumer registration so both the
 * worker AND the DB-backed tests get tenant-scoped handlers.
 *
 * withTenantConsumer(handler) enters runWithTenant(msg.tenantId, () => handler(msg)).
 */
import type { Queue } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";

export function tenantScoped(queue: Queue): Queue {
  return new Proxy(queue, {
    get(target, prop, receiver) {
      if (prop === "subscribe") {
        return <T>(topic: string, handler: (msg: T) => Promise<void>): void =>
          target.subscribe(topic, withTenantConsumer(handler as never) as never);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
