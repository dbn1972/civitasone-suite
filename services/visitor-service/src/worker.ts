import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { scannerDb } from "./shared/scanner-db.js";
import { runWithTenant } from "@civitasone/db";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";
import { startVisitRequestAutoReject } from "./modules/visit-request/auto-reject-worker.js";
import { startNoShowDetection } from "./modules/visit-request/no-show-worker.js";
import { startOvrstayDetection } from "./modules/check-in/overstay-worker.js";
import { startRecurringPassExpiryCheck } from "./modules/recurring-pass/expiry-worker.js";
import { startWaitingReminderCheck } from "./modules/check-in/waiting-reminder-worker.js";
import { startDataRetentionPurge } from "./modules/dpdp/purge-worker.js";
import { startNightlyAggregation } from "./modules/analytics/nightly-aggregation-worker.js";

// NOTE: module consumers below are added incrementally as each module is
// scaffolded (tasks 4.6, 6.11, 7.4, 9.10, 11.4, 12.5, 13.4, 15.6, 16.3).
// Uncomment/add the import + `register*Consumers(queue)` call for a module
// once its `modules/{module}/consumer.ts` exists.
//
import { registerBlacklistConsumers } from "./modules/blacklist/consumer.js";
import { registerVisitRequestConsumers }  from "./modules/visit-request/consumer.js";
import { registerDigitalPassConsumers }   from "./modules/digital-pass/consumer.js";
import { registerCheckInConsumers } from "./modules/check-in/consumer.js";
import { registerIdentityConsumers }        from "./modules/identity/consumer.js";
import { registerGroupVisitConsumers }    from "./modules/group-visit/consumer.js";
import { registerRecurringPassConsumers } from "./modules/recurring-pass/consumer.js";
import { registerMaterialPassConsumers }  from "./modules/material-pass/consumer.js";
import { registerVehiclePassConsumers }   from "./modules/vehicle-pass/consumer.js";
import { registerEvacuationConsumers }    from "./modules/evacuation/consumer.js";
import { registerDeviceRegistryConsumers } from "./modules/device-registry/consumer.js";
import { registerBadgePrintConsumers }     from "./modules/badge-print/consumer.js";
import { registerDocumentScanConsumers }   from "./modules/document-scan/consumer.js";
import { registerTurnstileControlConsumers } from "./modules/turnstile-control/consumer.js";
import { registerConfigRegistryConsumers } from "./modules/config-registry/consumer.js";
import { registerLocationConsumers } from "./modules/location/consumer.js";
import { registerDpdpConsumers } from "./modules/dpdp/consumer.js";
import { startHealthChecker, stopHealthChecker } from "./modules/device-registry/health-checker.js";
import { startImageCleanupWorker, stopImageCleanupWorker } from "./modules/document-scan/image-cleanup.js";

const log = pino({ name: "visitor-worker" });

// Fail-fast if VISITOR_PII_KEY is absent/too short so the worker never runs fail-open.

function assertScannerConfigured(): void {
  // Fail closed when FORCE RLS is on outbox and NODE_ENV=production: the
  // scanner DSN must be present and distinct from DATABASE_URL so relay/purge
  // cannot silently fall back to the NOBYPASSRLS service role.
  if ((process.env.NODE_ENV ?? "") !== "production") return;
  const scanner = process.env.VISITOR_SCANNER_DATABASE_URL ?? "";
  const primary = process.env.DATABASE_URL ?? "";
  if (!scanner || scanner === primary) {
    throw new Error(
      "VISITOR_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS scanner role required for outbox relay/purge under FORCE RLS)",
    );
  }
}

assertScannerConfigured();
assertPiiKeyConfigured();

// RLS write-path enforcement: visitor.* tables are FORCE ROW LEVEL SECURITY, so
// under the NOBYPASSRLS visitor_svc role a consumer can only read/write its
// tenant's rows when app.tenant_id is set. Wrap every consumer handler so the
// message's tenant context is active for its duration — getCurrentTenantId()
// then returns msg.tenantId and wrapWithTenantGuc sets the GUC on the handler's
// db.transaction(). Single-point wrap mirrors meeting-service's makeRouter
// runWithTenant (commit 904c302).
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

// Module consumer registrations — added one per module as each is scaffolded.
registerBlacklistConsumers(queue);
registerVisitRequestConsumers(queue);
registerDigitalPassConsumers(queue);
registerCheckInConsumers(queue);
registerIdentityConsumers(queue);
registerGroupVisitConsumers(queue);
registerRecurringPassConsumers(queue);
registerMaterialPassConsumers(queue);
registerVehiclePassConsumers(queue);
registerEvacuationConsumers(queue);
registerDeviceRegistryConsumers(queue);
registerBadgePrintConsumers(queue);
registerDocumentScanConsumers(queue);
registerTurnstileControlConsumers(queue);
registerConfigRegistryConsumers(queue);
registerLocationConsumers(queue);
registerDpdpConsumers(queue);

await queue.start();
// Cross-tenant outbox scan must use BYPASSRLS scannerDb — FORCE RLS on
// _outbox.messages (migration 0013) would otherwise hide all unpublished rows
// when app.tenant_id is unset.
const relay = startRelay(scannerDb as unknown as typeof db, queue);
// Scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(scannerDb as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("visitor-service worker: consumers + outbox relay running");

// Start device health checker — scans every 30s for offline devices.
startHealthChecker();

// Start image cleanup worker — deletes expired scan images (1h TTL).
startImageCleanupWorker();

// Scheduled auto-reject + reminder — checks every 15 minutes for stale pending visit requests.
// - 4h threshold: sends reminder notification to host (Requirement 3.4)
// - 24h threshold: auto-rejects and notifies visitor (Requirement 3.5)
const autoReject = startVisitRequestAutoReject(db, queue, {
  intervalMs: 15 * 60_000,
  reminderThresholdMs: 4 * 60 * 60_000,
  autoRejectThresholdMs: 24 * 60 * 60_000,
  logger: log,
}, scannerDb);

// Scheduled overstay detection — checks every 10 minutes for visitors past valid_until.
// - Standard overstay: publishes overstayDetect command (Requirement 6.3)
// - 2h+ overstay: escalates to security supervisor (Requirement 6.4)
const overstayDetection = startOvrstayDetection(scannerDb, queue, {
  intervalMs: 10 * 60_000,
  escalationThresholdMs: 2 * 60 * 60_000,
  logger: log,
});

// Scheduled no-show detection — checks every 15 minutes for approved visits past scheduledAt.
// - 30m post-scheduled: sends no-show warning to host (Requirement 16.3)
// - 2h post-scheduled: transitions to no_show, releases parking/resources (Requirement 16.4)
const noShowDetection = startNoShowDetection(db, queue, {
  intervalMs: 15 * 60_000,
  warningThresholdMs: 30 * 60_000,
  noShowThresholdMs: 2 * 60 * 60_000,
  logger: log,
}, scannerDb);

// Scheduled recurring-pass expiry notification — checks daily for active recurring passes
// expiring within 7 days. Notifies pass holder (SMS) + issuing manager (push).
// Requirement 12.5: "WHEN a Recurring_Pass expires or is revoked, THE Notification_Service
// SHALL notify the pass holder and the issuing facility manager."
const recurringPassExpiry = startRecurringPassExpiryCheck(scannerDb, queue, {
  intervalMs: 24 * 60 * 60_000,
  daysBeforeExpiry: 7,
  logger: log,
});

// Scheduled waiting-reminder — checks every 5 minutes for visitors who checked in
// 10+ minutes ago but whose host has not yet acknowledged their arrival.
// Requirement 16.5: "WHEN a visitor is waiting in the lobby for more than 10 minutes
// after check-in, THE Notification_Service SHALL send a waiting reminder to the Host."
const waitingReminder = startWaitingReminderCheck(scannerDb, queue, {
  intervalMs: 5 * 60_000,
  waitingThresholdMs: 10 * 60_000,
  waitingUpperBoundMs: 15 * 60_000,
  logger: log,
});

// Scheduled nightly analytics aggregation — runs every 24 hours.
// Queries visit_requests + check_ins for the previous day, computes daily
// metrics via domain.ts's computeDailyMetrics(), and inserts into daily_metrics.
// Requirement 19.1: daily-metrics aggregation (total visits, unique visitors,
// avg approval turnaround, avg visit duration, peak-hour distribution, no-show rate).
const nightlyAggregation = startNightlyAggregation(db, {
  intervalMs: 24 * 60 * 60_000,
  logger: log,
}, scannerDb);

// Scheduled DPDP data-retention PII purge — runs daily, purges PII from visit
// records whose last activity is older than the retention period (default 365 days).
// Requirement 18.3: retains anonymized statistical records after purging PII.
const dataRetentionPurge = startDataRetentionPurge(db, scannerDb, {
  intervalMs: 24 * 60 * 60_000,
  retentionPeriodMs: 365 * 24 * 60 * 60_000,
  erasureSlaMs: 72 * 60 * 60_000,
  batchSize: 500,
  logger: log,
});

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(autoReject);
  clearInterval(overstayDetection);
  clearInterval(noShowDetection);
  clearInterval(recurringPassExpiry);
  clearInterval(waitingReminder);
  clearInterval(nightlyAggregation);
  clearInterval(dataRetentionPurge);
  stopHealthChecker();
  stopImageCleanupWorker();
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
