import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerUserConsumers }    from "./modules/users/consumer.js";
import { registerRbacConsumers }    from "./modules/rbac/consumer.js";
import { registerSessionConsumers } from "./modules/sessions/consumer.js";
import { reapExpiredSessions }      from "./modules/sessions/repo.js";
import { sweepExpiredGrants }       from "./modules/breakglass/repo.js";
import { registerMfaConsumers }     from "./modules/mfa/consumer.js";
import { registerScimConsumers }    from "./modules/scim/consumer.js";
import { registerSyncFeederConsumers } from "./modules/sync/feeder.js";
import { registerIdentityTenantOnboardConsumers } from "./modules/tenant-onboard/consumer.js";
import { registerApiKeyConsumers } from "./modules/apikeys/consumer.js";
import { registerDeviceConsumers } from "./modules/devices/consumer.js";
import * as keycloak from "./shared/keycloak.js";
import { reconcileDueDeactivations, countPending } from "./shared/kc-reconcile.js";
import { runWithTenant } from "@civitasone/db";

const log = pino({ name: "identity-worker" });

// Wrap queue.subscribe to set tenant context from message — consumers run
// db.transaction() and RLS policies require app.tenant_id GUC to be set.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

registerUserConsumers(queue);
registerRbacConsumers(queue);
registerSessionConsumers(queue);
registerMfaConsumers(queue);
registerScimConsumers(queue);
registerSyncFeederConsumers(queue);
registerIdentityTenantOnboardConsumers(queue);
registerApiKeyConsumers(queue);
registerDeviceConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});

// P1-2: periodic expired-session reaper. Flips active-but-past-expiry sessions
// to "expired" so they stop counting as active sessions.
const REAP_INTERVAL_MS = Number(process.env.SESSION_REAP_INTERVAL_MS ?? 60000);
const reaper = setInterval(() => {
  void reapExpiredSessions()
    .then((n) => { if (n > 0) log.info({ reaped: n }, "expired sessions reaped"); })
    .catch((err) => log.error({ err }, "session reaper failed"));
}, REAP_INTERVAL_MS);
reaper.unref?.();

// Break-glass TTL sweep: flip active-but-past-expiry emergency grants to
// "expired" so elevated access never outlives its TTL.
const BG_SWEEP_INTERVAL_MS = Number(process.env.BREAK_GLASS_SWEEP_INTERVAL_MS ?? 60000);
const bgSweeper = setInterval(() => {
  void sweepExpiredGrants()
    .then((n) => { if (n > 0) log.warn({ expired: n }, "break-glass grants expired by TTL sweep"); })
    .catch((err) => log.error({ err: String(err) }, "break-glass sweep failed"));
}, BG_SWEEP_INTERVAL_MS);
bgSweeper.unref?.();

// SEC H2: periodic Keycloak deactivation reconciler.
const KC_RECONCILE_INTERVAL_MS = Number(process.env.KC_RECONCILE_INTERVAL_MS ?? 60000);
const kcReconciler = setInterval(() => {
  void reconcileDueDeactivations(db, (tenantId, email) => keycloak.deactivateUser(tenantId, email, log))
    .then(async ({ reconciled, retried }) => {
      if (reconciled > 0 || retried > 0) {
        const pending = await countPending(db).catch(() => -1);
        log.warn({ reconciled, retried, pending }, "keycloak deactivation reconciler pass");
      }
    })
    .catch((err) => log.error({ err: String(err) }, "keycloak reconciler failed"));
}, KC_RECONCILE_INTERVAL_MS);
kcReconciler.unref?.();

log.info("identity-service worker: consumers + outbox relay + session reaper + kc reconciler running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(reaper);
  clearInterval(bgSweeper);
  clearInterval(kcReconciler);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
