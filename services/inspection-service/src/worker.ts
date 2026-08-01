/**
 * SQS/RabbitMQ consumer entrypoint for inspection-service.
 * Subscribes to all COMMANDS + CONSUMED_EVENTS and starts the outbox relay.
 * Dead-lettering after max retries is handled natively by SQS RedrivePolicy
 * (see the DLQ handling section below) — this worker does not poll DLQ topics.
 *
 * Graceful shutdown: SIGTERM → stop queue consumers → clear outbox relay → close DB pool.
 *
 * _Requirements: 1.1, 1.2, 1.6, 1.9_
 */
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { tenantScoped } from "./shared/tenant-queue.js";
import { startOutboxPurge } from "@civitasone/outbox";

const log = pino({ name: "inspection-worker" });

// ── Consumer registration ────────────────────────────────────────────────────
import { registerUniverseConsumers } from "./modules/universe/consumer.js";
import { registerRiskConsumers } from "./modules/risk/consumer.js";
import { registerPlanningConsumers } from "./modules/planning/consumer.js";
import { registerAssignmentConsumers } from "./modules/assignment/consumer.js";
import { registerChecklistConsumers } from "./modules/checklist/consumer.js";
import { registerSyncConsumers } from "./modules/sync/consumer.js";
import { registerEvidenceConsumers } from "./modules/evidence/consumer.js";
import { registerExecutionConsumers } from "./modules/execution/consumer.js";
import { registerFindingsConsumers } from "./modules/findings/consumer.js";
import { registerCapaConsumers } from "./modules/capa/consumer.js";
import { registerEnforcementConsumers } from "./modules/enforcement/consumer.js";
import { registerLicenceConsumers } from "./modules/licence/consumer.js";
import { registerSurveyConsumers } from "./modules/survey/consumer.js";
import { registerTelemetryConsumers } from "./modules/telemetry/consumer.js";

// Tenant-scoped queue: enters runWithTenant(msg.tenantId) before each handler so
// wrapWithTenantGuc sets the app.tenant_id GUC and RLS-forced writes/reads succeed.
// (Inspection roles are NOBYPASSRLS and these consumers call db.transaction directly.)
const scopedQueue = tenantScoped(queue);

registerUniverseConsumers(scopedQueue);
registerRiskConsumers(scopedQueue);
registerPlanningConsumers(scopedQueue);
registerAssignmentConsumers(scopedQueue);
registerChecklistConsumers(scopedQueue);
registerSyncConsumers(scopedQueue);
registerEvidenceConsumers(scopedQueue);
registerExecutionConsumers(scopedQueue);
registerFindingsConsumers(queue);
registerCapaConsumers(queue);
registerEnforcementConsumers(queue);
registerLicenceConsumers(queue);
registerSurveyConsumers(queue);
registerTelemetryConsumers(queue);

// ── DLQ handling ─────────────────────────────────────────────────────────────
// No per-topic DLQ pollers here. Native SQS RedrivePolicy already dead-letters
// messages that exceed maxReceiveCount entirely inside SQS, with no consumer
// involvement required. Subscribing to a per-topic dead-letter queue for every
// COMMANDS/CONSUMED_EVENTS topic (one extra long-poller per topic — roughly 2x
// the total topic count) just multiplied this service's SQS ReceiveMessage
// traffic and open connections for
// no operational gain: DLQ depth/redrive is ops-side observability (CloudWatch/SQS
// console alarms on ApproximateNumberOfMessagesVisible), not something this
// worker needs to poll for.

// ── Start queue, outbox relay, and purge ─────────────────────────────────────
await queue.start();
const relay = startRelay(db, queue);
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("inspection-service worker: consumers + outbox relay running");

// ── Partition maintenance ────────────────────────────────────────────────────
// Auto-create monthly partitions 3 months ahead. Runs daily, idempotent.
async function ensurePartitions(): Promise<void> {
  try {
    await db.execute(sql`SELECT _outbox.create_future_partitions()`);
    log.info("partition maintenance: future partitions ensured");
  } catch (err) {
    log.warn({ err }, "partition maintenance: failed to create future partitions");
  }
}
void ensurePartitions();
const partitionMaint = setInterval(() => void ensurePartitions(), 24 * 60 * 60_000);
partitionMaint.unref();

// ── Overdue findings detection (Requirement 9.5) ─────────────────────────────
// Runs every hour. Finds findings in notice_issued state with past-due compliance
// notices, transitions them to overdue, and publishes escalation notification events.
import { findOverdueFindings, findOverdueFindingTenantIds, updateFindingState } from "./modules/findings/repo.js";
import { runWithTenant } from "@civitasone/db";
import { scopedPlatformRead } from "./shared/db.js";
import { EVENTS } from "./topics.js";

async function processOverdueFindings(): Promise<void> {
  try {
    // Step 1: candidate TENANT IDS ONLY via a scoped platform-bypass read (minimal
    // blast radius — ids, not rows). A bare db.execute()/db.transaction() here sets
    // no app.tenant_id GUC, so the strict tenant_isolation policy's
    // `tenant_id = current_tenant_id()` check never matches (current_tenant_id() is
    // NULL under no GUC) — this silently found ZERO tenants in every environment
    // before this fix. See shared/db.ts's scopedPlatformRead() doc comment.
    const tenantIds = await scopedPlatformRead((tx) => findOverdueFindingTenantIds(tx));

    for (const tenantId of tenantIds) {
      // Step 2: the actual overdue lookup + state-transition writes run under this
      // tenant's own strict-RLS GUC via runWithTenant — no bypass policy exists for
      // UPDATE, so writes always remain tenant-scoped.
      await runWithTenant(tenantId, async () => {
        const overdueFindings = await findOverdueFindings(tenantId);

        for (const finding of overdueFindings) {
          try {
            await db.transaction(async (tx) => {
              // Transition to overdue
              await updateFindingState(tx, finding.id, tenantId, "overdue", "system");

              // Emit overdue event via outbox for notification escalation
              const { enqueue: outboxEnqueue } = await import("./shared/outbox.js");
              await outboxEnqueue(tx, {
                topic: EVENTS.findingOverdue,
                eventType: EVENTS.findingOverdue,
                tenantId,
                actorId: "system",
                correlationId: `overdue-check-${finding.id}`,
                payload: {
                  findingId: finding.id,
                  findingNumber: finding.findingNumber,
                  inspectionId: finding.inspectionId,
                  entityId: finding.inspectionId,
                  dueDate: "past",
                },
              });

              // Notification escalation event
              await outboxEnqueue(tx, {
                topic: "notification.send",
                eventType: "notification.send",
                tenantId,
                actorId: "system",
                correlationId: `overdue-notif-${finding.id}`,
                payload: {
                  type: "finding.overdue_escalation",
                  data: {
                    findingId: finding.id,
                    findingNumber: finding.findingNumber,
                    inspectionId: finding.inspectionId,
                  },
                },
              });
            });

            log.info({ event: "finding_transitioned_overdue", findingId: finding.id, tenantId },
              "finding transitioned to overdue");
          } catch (err) {
            log.warn({ err, findingId: finding.id, tenantId, event: "overdue_transition_failed" },
              "failed to transition finding to overdue");
          }
        }
      });
    }
  } catch (err) {
    log.warn({ err, event: "overdue_check_failed" }, "overdue findings detection failed");
  }
}

// Run overdue check on startup (after brief delay) and then every hour
setTimeout(() => void processOverdueFindings(), 30_000);
const overdueCheck = setInterval(() => void processOverdueFindings(), 60 * 60_000);
overdueCheck.unref();

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(overdueCheck);
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
