import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerUserConsumers } from "./modules/users/consumer.js";
import { registerSessionConsumers } from "./modules/sessions/consumer.js";
import { reapExpiredSessions } from "./modules/sessions/repo.js";
import { registerMfaConsumers } from "./modules/mfa/consumer.js";
import { registerSyncFeederConsumers } from "./modules/sync/feeder.js";

const log = pino({ name: "identity-worker" });

registerUserConsumers(queue);
registerSessionConsumers(queue);
registerMfaConsumers(queue);
registerSyncFeederConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);

// P1-2: periodic expired-session reaper. Flips active-but-past-expiry sessions
// to "expired" so they stop counting as active sessions.
const REAP_INTERVAL_MS = Number(process.env.SESSION_REAP_INTERVAL_MS ?? 60000);
const reaper = setInterval(() => {
  void reapExpiredSessions()
    .then((n) => { if (n > 0) log.info({ reaped: n }, "expired sessions reaped"); })
    .catch((err) => log.error({ err }, "session reaper failed"));
}, REAP_INTERVAL_MS);
reaper.unref?.();

log.info("identity-service worker: consumers + outbox relay + session reaper running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(reaper);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
