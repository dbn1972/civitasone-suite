import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.ai-fraud.consumer" });
const AUDIT = "audit.event.record";

export function registerAiFraudConsumers(queue: Queue): void {
  queue.subscribe("hrms.ai_fraud.scan", async (msg) => {
    const p = msg.payload as { tenantId: string; triggeredBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.ai_fraud.scan_completed",
        eventType: "hrms.ai_fraud.scan_completed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId, triggeredBy: p.triggeredBy },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "ai_fraud_scan", resourceType: "fraud_scan", resourceId: msg.messageId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:ai_fraud:*`);
    log.info({ id: msg.messageId }, "Processed ai_fraud.scan");
  });

  queue.subscribe("hrms.ai_fraud.alert_update", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; status: string; resolutionNotes?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.ai_fraud.alert_updated",
        eventType: "hrms.ai_fraud.alert_updated",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { alertId: p.id, status: p.status },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "ai_fraud_alert_update", resourceType: "fraud_alert", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:ai_fraud:*`);
    log.info({ id: msg.messageId, alertId: p.id }, "Processed ai_fraud.alert_update");
  });
}
