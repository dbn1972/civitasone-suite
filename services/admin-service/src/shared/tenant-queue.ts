/**
 * tenantScoped — wrap a Queue so every subscribed handler runs inside the
 * message's tenant context (AsyncLocalStorage via withTenantConsumer). Required
 * for consumers that write to FORCE-RLS tables (e.g. admin.vapt_scans): the
 * shared `db` only sets the app.tenant_id GUC inside db.transaction() when a
 * tenant context is active. Mirrors telephony-service/src/shared/tenant-queue.ts.
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
