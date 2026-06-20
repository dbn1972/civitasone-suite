import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRateConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.rcCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; rcNo: string; vendorId: string; title: string;
      validFrom: string; validUntil: string;
      items: Array<{ itemCode: string; description: string; unit: string; unitPriceMinor: number; currency?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRc(tx, {
        id: p.id, tenantId: p.tenantId, rcNo: p.rcNo, vendorId: p.vendorId,
        title: p.title, validFrom: p.validFrom, validUntil: p.validUntil, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const itemRows = p.items.map((i) => ({
        id: randomUUID(), rcId: p.id, tenantId: p.tenantId,
        itemCode: i.itemCode, description: i.description, unit: i.unit,
        unitPriceMinor: BigInt(i.unitPriceMinor), currency: i.currency ?? "INR",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertRcItems(tx, itemRows);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "contract", action: "create", resourceType: "rate_contract", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rc", p.id));
  });
}
