import { withTenantConsumer } from "@civitasone/db";
import type { createQueue } from "@civitasone/queue";

type TenantHandler<T> = Parameters<typeof withTenantConsumer<T>>[0];

export function tenantScoped(
  rawQueue: ReturnType<typeof createQueue>,
): ReturnType<typeof createQueue> {
  return new Proxy(rawQueue, {
    get(target, prop, receiver) {
      if (prop === "subscribe") {
        // withTenantConsumer's return type is @civitasone/db's own Handler<T>
        // (msg: T & CommandEnvelope), which is structurally compatible with but
        // nominally distinct from @civitasone/queue's Handler<T> expected by
        // target.subscribe — TS can't unify the two independently-defined
        // generic envelope types here, so a narrow assertion bridges them.
        return <T>(topic: string, handler: TenantHandler<T>) =>
          target.subscribe(topic, withTenantConsumer(handler) as never);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
