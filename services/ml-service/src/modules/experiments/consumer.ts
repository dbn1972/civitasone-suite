/**
 * Experiments consumer — applies A/B experiment create/end commands via CQRS.
 *
 * Each handler:
 *   1. Calls markProcessed for idempotency
 *   2. Applies Drizzle write (insert or update)
 *   3. Enqueues audit.event.record via transactional outbox
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { mlExperiments } from "../training/schema.js";
import { recordConsumerMessage } from "../observability/metrics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "ml-experiments-consumer" });

type CreatePayload = {
  id: string;
  tenantId: string;
  domain: string;
  name: string;
  challengerModelId: string;
  currentModelId: string;
  splitPct: number;
};

type EndPayload = {
  id: string;
  tenantId: string;
  status: "completed" | "cancelled";
};

export function registerExperimentConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe<CreatePayload>(COMMANDS.experimentCreate, async (msg) => {
    const startMs = Date.now();
    const p = msg.payload;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        await tx.insert(mlExperiments).values({
          id: p.id,
          tenantId: p.tenantId,
          domain: p.domain,
          name: p.name,
          challengerModelId: p.challengerModelId,
          currentModelId: p.currentModelId,
          splitPct: p.splitPct,
          status: "active",
          createdBy: msg.actorId,
        });

        await emitAudit(tx, msg, "experiment.created", p.id, {
          domain: p.domain,
          name: p.name,
          reason: `Experiment "${p.name}" created for domain: ${p.domain}`,
        });
      });

      recordConsumerMessage({
        messageId: msg.messageId,
        topic: COMMANDS.experimentCreate,
        tenantId: p.tenantId,
        processingTimeMs: Date.now() - startMs,
        outcome: "processed",
      });

      log.info({ experimentId: p.id, tenantId: p.tenantId }, "experiment created");
    } catch (err) {
      recordConsumerMessage({
        messageId: msg.messageId,
        topic: COMMANDS.experimentCreate,
        tenantId: p.tenantId,
        processingTimeMs: Date.now() - startMs,
        outcome: "failed",
      });
      throw err;
    }
  });

  queue.subscribe<EndPayload>(COMMANDS.experimentEnd, async (msg) => {
    const startMs = Date.now();
    const p = msg.payload;
    const auditAction = p.status === "completed" ? "experiment.ended" : "experiment.cancelled";

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const [row] = await tx
          .update(mlExperiments)
          .set({
            status: p.status,
            endedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(mlExperiments.id, p.id), eq(mlExperiments.tenantId, p.tenantId)))
          .returning();

        if (!row) {
          log.warn({ experimentId: p.id, tenantId: p.tenantId }, "experiment end: not found — skipping write");
          return;
        }

        await emitAudit(tx, msg, auditAction, p.id, {
          domain: row.domain,
          outcome: p.status,
          reason: `Experiment ${p.status} for domain: ${row.domain}`,
        });
      });

      recordConsumerMessage({
        messageId: msg.messageId,
        topic: COMMANDS.experimentEnd,
        tenantId: p.tenantId,
        processingTimeMs: Date.now() - startMs,
        outcome: "processed",
      });

      log.info({ experimentId: p.id, status: p.status, tenantId: p.tenantId }, "experiment ended");
    } catch (err) {
      recordConsumerMessage({
        messageId: msg.messageId,
        topic: COMMANDS.experimentEnd,
        tenantId: p.tenantId,
        processingTimeMs: Date.now() - startMs,
        outcome: "failed",
      });
      throw err;
    }
  });

  log.info("experiments consumers registered");
}

async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  details: { domain: string; reason: string; name?: string; outcome?: string },
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "ml",
      action,
      resourceType: "ml-experiment",
      resourceId,
      reason: details.reason,
      metadata: {
        domain: details.domain,
        ...(details.name ? { name: details.name } : {}),
        ...(details.outcome ? { outcome: details.outcome } : {}),
      },
      timestamp: new Date().toISOString(),
    },
  });
}
