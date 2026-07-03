import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.dashboard.consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerDashboardConsumers(queue: Queue): void {
  queue.subscribe("finance.dashboard.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "finance", action: "dashboard_refresh", resourceType: "dashboard", resourceId: msg.tenantId, outcome: "success" },
      });
    });
    await cache.invalidate(`finance:${p.tenantId}:dashboard:*`);
    log.info({ id: msg.messageId }, "Processed dashboard.refresh");
  });
}
