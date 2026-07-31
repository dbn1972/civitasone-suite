/**
 * catalogue-service consumer / outbox relay entrypoint.
 * Processes commands from SQS/RabbitMQ and relays outbox events.
 */
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";

async function main(): Promise<void> {
  // Start outbox relay (positional: db, queue, intervalMs, service)
  startRelay(db, queue, 1000, SERVICE);

  // Graceful shutdown
  const shutdown = async () => {
    await sqlClient.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
