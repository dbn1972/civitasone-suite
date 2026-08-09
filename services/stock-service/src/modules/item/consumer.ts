import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerItemConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.itemCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; code: string; categoryId: string;
      uomId: string; itemType?: string; reorderLevel?: number; reorderQty?: number; valuationMethod?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertItem(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, code: p.code,
        categoryId: p.categoryId, uomId: p.uomId,
        itemType: p.itemType ?? "consumable",
        reorderLevel: p.reorderLevel ?? 0, reorderQty: p.reorderQty ?? 0,
        valuationMethod: p.valuationMethod ?? "WAVG",
        isActive: true, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "item", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "item", p.id));
    await cache.invalidateResource(msg.tenantId, "item");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "stock", action, resourceType, resourceId, outcome: "success" },
  });
}
