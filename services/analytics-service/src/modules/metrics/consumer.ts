/** saved metrics consumer — writes saved_metrics; idempotent; audited. */
import { pino } from "pino";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, AUDIT_TOPIC, METRIC_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "analytics-metrics-consumer" });
type Tx = Parameters<typeof enqueue>[0];

async function emitAndAudit(tx: Tx, msg: CommandEnvelope, id: string, name: string): Promise<void> {
  await enqueue(tx, {
    topic: EVENTS.metricSaved,
    eventType: EVENTS.metricSaved,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { savedMetricId: id, name },
  });
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "analytics", action: "save", resourceType: "saved_metric", resourceId: id, outcome: "success" },
  });
}

export function registerMetricsConsumers(queue: Queue): void {
  queue.subscribe<Record<string, unknown>>(COMMANDS.saveMetric, async (msg) => {
    try {
      const p = msg.payload as { id: string; name: string; metricKey: string; spec: Record<string, unknown> };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insert(tx, {
          id: p.id,
          tenantId: msg.tenantId,
          name: p.name,
          metricKey: p.metricKey,
          spec: p.spec,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await emitAndAudit(tx, msg, p.id, p.name);
      });
      await cache.invalidateResource(msg.tenantId, METRIC_RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.saveMetric }, "Consumer processing failed");
    }
  });
}
