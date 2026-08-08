import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerAnalyticsConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  q.subscribe<{ tenantId: string; deliveryId: string }>(
    COMMANDS.recordOpen, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.recordOpen(tx, p.tenantId, p.deliveryId);
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "notification-service", action: "analytics.recordOpen", resourceType: "delivery", resourceId: p.deliveryId, outcome: "success" },
        });
      });
    },
  );

  q.subscribe<{ tenantId: string; deliveryId: string; linkUrl: string }>(
    COMMANDS.recordClick, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.recordClick(tx, p.tenantId, p.deliveryId, p.linkUrl);
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "notification-service", action: "analytics.recordClick", resourceType: "delivery", resourceId: p.deliveryId, outcome: "success" },
        });
      });
    },
  );
}
