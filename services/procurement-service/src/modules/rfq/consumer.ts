import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { allocateDocNo } from "../../shared/numbering.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRfqConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.rfqCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; title: string; description?: string; indentRef?: string;
      closingDate: string; vendorIds: string[];
      items?: Array<{ itemName: string; quantity: number; unit: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Gapless server-generated number (#12) — ignore any client-supplied rfqNo.
      const rfqNo = await allocateDocNo(tx, p.tenantId, "rfq");
      await repo.insertRfq(tx, {
        id: p.id, tenantId: p.tenantId, rfqNo, title: p.title,
        description: p.description ?? null, indentRef: p.indentRef ?? null,
        vendorsInvited: p.vendorIds.length, responsesReceived: 0,
        closingDate: p.closingDate, status: "issued",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const items = p.items ?? [];
      if (items.length > 0) {
        await repo.insertRfqItems(tx, items.map((i) => ({
          id: randomUUID(), rfqId: p.id, tenantId: p.tenantId,
          itemName: i.itemName, quantity: i.quantity, unit: i.unit,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        })));
      }
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "procurement", action: "create", resourceType: "rfq", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rfq", p.id));
  });
}
