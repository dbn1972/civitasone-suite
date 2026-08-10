import { withTenantConsumer } from "@civitasone/db";
import type { createQueue } from "@civitasone/queue";

export function tenantScoped(
  rawQueue: ReturnType<typeof createQueue>,
): ReturnType<typeof createQueue> {
  return new Proxy(rawQueue, {
    get(target, prop, receiver) {
      if (prop === "subscribe") {
        return (topic: string, handler: (...args: unknown[]) => unknown) =>
          target.subscribe(topic, withTenantConsumer(handler));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
