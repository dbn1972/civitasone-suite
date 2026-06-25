import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerTicketConsumers } from "./modules/tickets/consumer.js";
import { startSlaSweeper } from "./modules/tickets/sweeper.js";

const log = pino({ name: "helpdesk-worker" });

registerTicketConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// HD1 — SLA-breach sweeper: notifies + escalates + audits once per breach/at-risk stage.
const slaSweeper = startSlaSweeper(Number(process.env.HELPDESK_SLA_SWEEP_MS ?? 30_000));
log.info("helpdesk-service worker: consumers + outbox relay + sla sweeper running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(slaSweeper);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
