/**
 * queue-service / messaging abstraction layer
 * ─────────────────────────────────────────────────────────────────
 * Domain owner: async messaging, adapter abstraction
 * Tables owned: queue_messages, queue_consumers, queue_dead_letters
 * Vol 3 §9 + Vol 1/4.13: queue adapter is pluggable — SQS / Kafka / RabbitMQ
 * Services must NOT import provider SDKs directly. Use this abstraction only.
 * Vol 13: writes must be queue-first. Direct DB writes are scalability violations.
 * Queue naming: {env}.{service}.{entity}.{action}
 * ─────────────────────────────────────────────────────────────────
 */

// ── Low-level bus abstraction (used by domain services via @civitasone/queue) ──
export {
  createQueue,
  resolveQueueDriver,
  MemoryQueue,
  NonRetryableError,
  isNonRetryable,
  isFifoTopic,
  SqsQueue,
} from "./bus.js";

export type {
  CommandEnvelope,
  PublishInput,
  Handler,
  Queue,
  QueueDriver,
  PublishOptions,
} from "./bus.js";

// ── SQS adapter (used when QUEUE_DRIVER=sqs in production) ──
// SqsQueue is defined in bus.ts alongside MemoryQueue

// ── wrapQueueAsClient bridge ──
export { wrapQueueAsClient } from "./client-bridge.js";

// ── High-level QueueClient abstraction (re-exported from types.ts) ──
export type {
  QueueAdapter,
  QueuePublishOptions,
  QueueConsumeOptions,
  IncomingMessage,
  QueueClient,
} from "./types.js";

// Factory resolved at startup — adapter selected via QUEUE_ADAPTER env var
export async function createQueueClient(): Promise<import("./types.js").QueueClient> {
  // --- Production SQS safety guard ---
  // AWS_ENDPOINT_URL is set in dev/CI to point at LocalStack. In production it
  // must be absent so the SDK resolves real AWS SQS. If it somehow leaks into a
  // production deployment we refuse to start rather than silently misdirecting
  // traffic to LocalStack.
  const endpoint = process.env.AWS_ENDPOINT_URL ?? process.env.EP ?? "";
  if (
    process.env.NODE_ENV === "production" &&
    (endpoint.includes("localhost") || endpoint.includes("127.0.0.1"))
  ) {
    throw new Error(
      "AWS_ENDPOINT_URL points to localhost in production — LocalStack endpoint must not be used in production"
    );
  }
  // Log effective endpoint at startup for observability (empty string = real AWS).
  // Using process.stdout to avoid a circular dep on server.log at package level.
  process.stdout.write(
    JSON.stringify({
      level: "info",
      msg: "queue-service startup",
      adapter: process.env.QUEUE_ADAPTER ?? "rabbitmq",
      awsEndpoint: endpoint || "(real AWS)",
      env: process.env.NODE_ENV ?? "development",
    }) + "\n"
  );

  const adapter = (process.env.QUEUE_ADAPTER ?? "rabbitmq") as import("./types.js").QueueAdapter;
  switch (adapter) {
    case "sqs":
      return (await import("./adapters/sqs.js")).createSqsClient();
    case "kafka":
      return (await import("./adapters/kafka.js")).createKafkaClient();
    case "rabbitmq":
      return (await import("./adapters/rabbitmq.js")).createRabbitMqClient();
    default:
      throw new Error(`Unsupported QUEUE_ADAPTER: ${adapter}. Must be sqs | kafka | rabbitmq`);
  }
}
