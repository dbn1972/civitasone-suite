/**
 * @civitasone/queue-service
 * Canonical messaging layer for CivitasOne.
 * Services use @civitasone/queue (facade) which re-exports this package.
 */
export type {
  CommandEnvelope,
  PublishInput,
  Handler,
  Queue,
  QueueDriver,
} from "./bus.js";
export { MemoryQueue, SqsQueue, createQueue, resolveQueueDriver } from "./bus.js";

export type {
  QueueAdapter,
  QueueClient,
  QueuePublishOptions,
  QueueConsumeOptions,
  IncomingMessage,
} from "./types.js";

export { wrapQueueAsClient } from "./client-bridge.js";

import type { QueueAdapter } from "./types.js";
import type { QueueClient } from "./types.js";
import { resolveQueueDriver } from "./bus.js";

function adapterFromDriver(driver: string): QueueAdapter {
  if (driver === "sqs") return "sqs";
  if (driver === "kafka") return "kafka";
  if (driver === "rabbitmq") return "rabbitmq";
  return "memory";
}

/** Legacy QueueClient factory — wraps the same bus as createQueue(). */
export async function createQueueClient(): Promise<QueueClient> {
  const envAdapter = process.env.QUEUE_ADAPTER as QueueAdapter | undefined;
  const adapter = envAdapter ?? adapterFromDriver(resolveQueueDriver());

  switch (adapter) {
    case "sqs":
      return (await import("./adapters/sqs.js")).createSqsClient();
    case "memory":
      return (await import("./adapters/memory.js")).createMemoryClient();
    case "kafka":
      return (await import("./adapters/kafka.js")).createKafkaClient();
    case "rabbitmq":
      return (await import("./adapters/rabbitmq.js")).createRabbitMqClient();
    default:
      throw new Error(`Unsupported QUEUE_ADAPTER: ${adapter}. Use sqs | memory | kafka | rabbitmq`);
  }
}

export { buildApp } from "./app.js";
