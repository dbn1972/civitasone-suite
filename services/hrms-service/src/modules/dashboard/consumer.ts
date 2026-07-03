import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.dashboard.consumer" });
const AUDIT = "audit.event.record";

export function registerDashboardConsumers(queue: Queue): void {
  queue.subscribe("hrms.dashboard.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.dashboard.refreshed",
        eventType: "hrms.dashboard.refreshed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "dashboard_refresh", resourceType: "dashboard", resourceId: msg.messageId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:dashboard:*`);
    log.info({ id: msg.messageId }, "Processed dashboard.refresh");
  });
}
