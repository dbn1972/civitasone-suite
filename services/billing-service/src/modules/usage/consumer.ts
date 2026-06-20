import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { periodMonthFromDate } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerUsageConsumers(queue: Queue): void {
  queue.subscribe<{ tenantId: string; metricKey: string; quantity: number }>(COMMANDS.usageRecord, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const qty = BigInt(msg.payload.quantity);
      await repo.insertEvent(tx, msg.payload.tenantId, msg.payload.metricKey, qty, msg.actorId);
      const periodMonth = periodMonthFromDate(new Date());
      await repo.upsertAggregate(tx, msg.payload.tenantId, msg.payload.metricKey, periodMonth, qty, msg.actorId);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.payload.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "billing", action: "usage_record", resourceType: "usage", resourceId: msg.payload.metricKey, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.payload.tenantId, "usage", msg.payload.tenantId));
  });
}
