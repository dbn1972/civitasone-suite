/**
 * SQS/RabbitMQ consumer entrypoint for inspection-service.
 * Subscribes to all COMMANDS + CONSUMED_EVENTS, starts the outbox relay,
 * and handles DLQ routing for messages that fail after max retries.
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
import { COMMANDS, CONSUMED_EVENTS } from "./topics.js";
import { incrementDlqMessage, captureError } from "@civitasone/observability";

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
// Subscribe to DLQ topics for observability. Messages that exceed max retries
// are logged with full context so operators can investigate and replay.
const allTopics = [...Object.values(COMMANDS), ...Object.values(CONSUMED_EVENTS)];

for (const topic of allTopics) {
  const dlqTopic = `${topic}.dlq`;
  queue.subscribe(dlqTopic, async (msg) => {
    incrementDlqMessage(topic);
    captureError(new Error(`DLQ message received: ${topic}`), {
      service: "inspection-service",
      topic,
      correlationId: msg.correlationId,
      messageId: msg.messageId,
      tenantId: msg.tenantId,
    });
    log.error(
      {
        event: "dlq_received",
        topic,
        messageId: msg.messageId,
        tenantId: msg.tenantId,
        correlationId: msg.correlationId,
      },
      "message dead-lettered after max retries",
    );
  });
}

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
import { findOverdueFindings, updateFindingState } from "./modules/findings/repo.js";
import { EVENTS } from "./topics.js";

async function processOverdueFindings(): Promise<void> {
  try {
    // We need to iterate tenants — for now use a direct query to get distinct tenants
    const tenantRows = await db.execute(sql`SELECT DISTINCT tenant_id FROM findings.findings WHERE state = 'notice_issued' AND deleted_at IS NULL`);
    const tenantIds = (tenantRows as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id);

    for (const tenantId of tenantIds) {
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
