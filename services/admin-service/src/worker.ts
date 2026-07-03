import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerTenantConsumers } from "./modules/tenants/consumer.js";
import { registerConfigConsumers } from "./modules/config/consumer.js";
import { registerBackupConsumers } from "./modules/backup/consumer.js";
import { registerSupportConsumers, startBreakGlassSweeper, sweepExpiredBreakGlass } from "./modules/support/consumer.js";
import { registerScheduledJobConsumers } from "./modules/scheduled-jobs/consumer.js";
import { registerCustomDomainConsumers } from "./modules/custom-domains/consumer.js";

const log = pino({ name: "admin-worker" });

registerTenantConsumers(queue);
registerConfigConsumers(queue);
registerBackupConsumers(queue);
registerSupportConsumers(queue);
registerScheduledJobConsumers(queue);
registerCustomDomainConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);

// P1-2: periodically auto-close break-glass grants past their TTL.
const breakGlassSweepMs = Number(process.env.BREAK_GLASS_SWEEP_MS ?? 60_000);
const breakGlassSweeper = startBreakGlassSweeper(breakGlassSweepMs);
// Run one sweep immediately on boot so grants that expired while the worker was
// down are closed without waiting a full interval.
void sweepExpiredBreakGlass()
  .then((n) => { if (n > 0) log.info({ swept: n }, "break-glass: closed expired grants on boot"); })
  .catch((err) => log.error({ err }, "break-glass sweep failed"));

log.info("admin-service worker: consumers + outbox relay + break-glass sweeper running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(breakGlassSweeper);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
