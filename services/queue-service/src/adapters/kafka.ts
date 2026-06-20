import type { QueueClient } from "../types.js";

export async function createKafkaClient(): Promise<QueueClient> {
  throw new Error(
    "Kafka adapter is not implemented yet. Set QUEUE_DRIVER=sqs or QUEUE_DRIVER=memory.",
  );
}
