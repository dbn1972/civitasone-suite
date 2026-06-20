import { createQueue } from "../bus.js";
import { wrapQueueAsClient } from "../client-bridge.js";
import type { QueueClient } from "../types.js";

export function createMemoryClient(): QueueClient {
  return wrapQueueAsClient(createQueue(), "memory");
}
