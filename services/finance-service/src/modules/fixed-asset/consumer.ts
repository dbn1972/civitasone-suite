import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.fixed-asset.consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerFixedAssetConsumers(queue: Queue): void {
  queue.subscribe("finance.fixed_asset.register_refresh", async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "finance", action: "fixed_asset_register_refresh", resourceType: "fixed_asset", resourceId: msg.tenantId, outcome: "success" },
      });
    });
    await cache.invalidate(`finance:${p.tenantId}:fixed_asset:*`);
    log.info({ id: msg.messageId }, "Processed fixed_asset.register_refresh");
  });
}
