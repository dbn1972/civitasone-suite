import { createMemoryClient } from "./memory.js";
import type { QueueClient } from "../types.js";

/** Local dev shim — routes to in-memory bus until RabbitMQ adapter ships. */
export function createRabbitMqClient(): QueueClient {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RabbitMQ adapter is not implemented. Use QUEUE_DRIVER=sqs in production.",
    );
  }
  return createMemoryClient();
}
