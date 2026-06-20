import { createQueue } from "../bus.js";
import { wrapQueueAsClient } from "../client-bridge.js";
import type { QueueClient } from "../types.js";

export function createSqsClient(): QueueClient {
  const prev = process.env.QUEUE_DRIVER;
  process.env.QUEUE_DRIVER = "sqs";
  try {
    return wrapQueueAsClient(createQueue(), "sqs");
  } finally {
    if (prev === undefined) delete process.env.QUEUE_DRIVER;
    else process.env.QUEUE_DRIVER = prev;
  }
}
