import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.hoa.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerHoaConsumers(queue: Queue): void {
  queue.subscribe("finance.hoa.major_head_sync", async (msg) => {
    const p = msg.payload as { tenantId: string; source?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "finance.hoa.synced", eventType: "finance.hoa.synced",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { source: p.source ?? "cga_master" },
      });
      await audit(tx, msg, "sync_major_heads", "hoa", msg.messageId);
    });
    await cache.invalidate(`finance:${msg.tenantId}:hoa:*`);
    log.info({ id: msg.messageId }, "Processed hoa.major_head_sync");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
