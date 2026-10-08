import { randomUUID } from "node:crypto";
import type { Queue } from "./bus.js";
import type {
  QueueAdapter,
  QueueClient,
  QueueConsumeOptions,
  QueuePublishOptions,
} from "./types.js";

export function wrapQueueAsClient(queue: Queue, adapter: QueueAdapter): QueueClient {
  return {
    async publish(options: QueuePublishOptions): Promise<void> {
      await queue.publish(options.queue, {
        // Forward the caller's idempotency key as the stable messageId so a
        // retried publish reuses it (consumer-side dedup); fall back to a fresh
        // id only when the caller supplied none.
        messageId: options.idempotencyKey ?? randomUUID(),
        type: options.queue,
        tenantId: options.tenantId,
        actorId: options.tenantId,
        correlationId: options.correlationId,
        schemaVersion: "1.0",
        payload: options.payload,
      });
    },

    async consume(options: QueueConsumeOptions): Promise<void> {
      queue.subscribe(options.queue, async (msg) => {
        await options.handler({
          messageId: msg.messageId,
          tenantId: msg.tenantId,
          payload: msg.payload,
          correlationId: msg.correlationId,
          retryCount: 0,
          receivedAt: new Date(msg.timestamp),
        });
      });
      await queue.start();
    },

    async healthCheck() {
      const status = await queue.healthCheck();
      return { healthy: status.healthy, adapter };
    },
  };
}
