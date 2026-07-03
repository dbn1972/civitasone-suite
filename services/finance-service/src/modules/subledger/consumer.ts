import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.subledger.consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerSubledgerConsumers(queue: Queue): void {
  queue.subscribe("finance.subledger.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string; side?: "ap" | "ar" };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "finance", action: "subledger_refresh", resourceType: "subledger", resourceId: p.side ?? msg.tenantId, outcome: "success" },
      });
    });
    await cache.invalidate(`finance:${p.tenantId}:subledger:*`);
    log.info({ id: msg.messageId, side: p.side }, "Processed subledger.refresh");
  });
}
