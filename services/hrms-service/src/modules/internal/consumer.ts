import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.internal.consumer" });
const AUDIT = "audit.event.record";

export function registerInternalConsumers(queue: Queue): void {
  queue.subscribe("hrms.internal.payroll_snapshot", async (msg) => {
    const p = msg.payload as { tenantId: string; month: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.internal.payroll_snapshot_ready",
        eventType: "hrms.internal.payroll_snapshot_ready",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId, month: p.month },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "payroll_snapshot", resourceType: "payroll_input", resourceId: msg.messageId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:internal:*`);
    log.info({ id: msg.messageId, month: p.month }, "Processed internal.payroll_snapshot");
  });
}
