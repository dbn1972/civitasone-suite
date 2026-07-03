import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.ai-predictions.consumer" });
const AUDIT = "audit.event.record";

export function registerAiPredictionsConsumers(queue: Queue): void {
  queue.subscribe("hrms.ai_predictions.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string; models: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.ai_predictions.refreshed",
        eventType: "hrms.ai_predictions.refreshed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId, models: p.models },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "ai_predictions_refresh", resourceType: "ai_prediction", resourceId: msg.messageId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:ai_predictions:*`);
    log.info({ id: msg.messageId }, "Processed ai_predictions.refresh");
  });
}
