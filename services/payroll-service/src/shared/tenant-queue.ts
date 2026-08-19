/**
 * tenantScoped — wrap a Queue so every subscribed handler runs inside
 * the message's tenant context (RLS-safe).
 */
import type { Queue, SubscribeOptions } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";

export function tenantScoped(queue: Queue): Queue {
  return new Proxy(queue, {
    get(target, prop, receiver) {
      if (prop === "subscribe") {
        return <T>(topic: string, handler: (msg: T) => Promise<void>, options?: SubscribeOptions): void =>
          target.subscribe(topic, withTenantConsumer(handler as never) as never, options);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

