import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.scheduler.consumer" });
const AUDIT = "audit.event.record";

export function registerSchedulerConsumers(queue: Queue): void {
  queue.subscribe("hrms.scheduler.run", async (msg) => {
    const p = msg.payload as { tenantId: string; asOf?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.scheduler.run_completed",
        eventType: "hrms.scheduler.run_completed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId, asOf: p.asOf },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "scheduler_run", resourceType: "scheduler", resourceId: msg.messageId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:scheduler:*`);
    log.info({ id: msg.messageId }, "Processed scheduler.run");
  });
}
