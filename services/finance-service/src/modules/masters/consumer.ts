import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.masters.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerMastersConsumers(queue: Queue): void {
  queue.subscribe("finance.masters.ddo_sync", async (msg) => {
    const p = msg.payload as { tenantId: string; source?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "finance.masters.synced", eventType: "finance.masters.synced",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { masterType: "ddo", source: p.source ?? "pfms" },
      });
      await audit(tx, msg, "sync_ddo", "masters", msg.messageId);
    });
    await cache.invalidate(`finance:${msg.tenantId}:masters:*`);
    log.info({ id: msg.messageId }, "Processed masters.ddo_sync");
  });

  queue.subscribe("finance.masters.pao_sync", async (msg) => {
    const p = msg.payload as { tenantId: string; source?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "finance.masters.synced", eventType: "finance.masters.synced",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { masterType: "pao", source: p.source ?? "pfms" },
      });
      await audit(tx, msg, "sync_pao", "masters", msg.messageId);
    });
    await cache.invalidate(`finance:${msg.tenantId}:masters:*`);
    log.info({ id: msg.messageId }, "Processed masters.pao_sync");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
