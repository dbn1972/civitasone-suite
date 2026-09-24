/**
 * tenantScoped — wrap a Queue so every subscribed command handler runs inside
 * the message's tenant context (AsyncLocalStorage via runWithTenant).
 *
 * WHY: notification domain tables have FORCED row-level security whose policy is
 * `tenant_id = current_tenant_id()`. The shared `db` (wrapWithTenantGuc) only
 * sets the `app.tenant_id` GUC inside db.transaction() when a tenant context is
 * active. Consumers call db.transaction() directly, so without establishing the
 * context first EVERY insert/update is rejected by RLS ("new row violates
 * row-level security policy"). Same fix as telephony-service (PR #152): apply it
 * at consumer-registration so both the worker AND the DB-backed tests get
 * tenant-scoped handlers.
 *
 * withTenantConsumer(handler) enters runWithTenant(msg.tenantId, () => handler(msg)).
 */
import type { Queue, SubscribeOptions } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";

export function tenantScoped(queue: Queue): Queue {
  return new Proxy(queue, {
    get(target, prop, receiver) {
      if (prop === "subscribe") {
        // G-ASYNC-1: this previously took only (topic, handler) and never
        // forwarded a 3rd `options` argument to the real subscribe() at all
        // — so ANY caller passing options (onOutcome, visibilityTimeout)
        // through a tenantScoped() queue had them silently dropped, no error,
        // no log. Exactly the class of silent failure this fix is about, one
        // layer down in the transport plumbing. Forward it through.
        return <T>(topic: string, handler: (msg: T) => Promise<void>, options?: SubscribeOptions): void =>
          target.subscribe(topic, withTenantConsumer(handler as never) as never, options);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
