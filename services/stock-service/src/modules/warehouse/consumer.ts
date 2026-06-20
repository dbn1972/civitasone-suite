import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { stockWarehouses } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerWarehouseConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.warehouseCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; code: string; address?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(stockWarehouses).values({
        id: p.id, tenantId: p.tenantId, name: p.name, code: p.code,
        address: p.address ?? null, isActive: true,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "stock", action: "create", resourceType: "warehouse", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
