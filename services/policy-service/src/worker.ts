import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerRoleConsumers } from "./modules/roles/consumer.js";
import { registerBindingConsumers } from "./modules/bindings/consumer.js";
import { registerAbacConsumers } from "./modules/abac/consumer.js";
import { registerRoleFeatureConsumers } from "./modules/role-features/consumer.js";

const log = pino({ name: "policy-worker" });
registerRoleConsumers(queue);
registerBindingConsumers(queue);
registerAbacConsumers(queue);
registerRoleFeatureConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("policy-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
