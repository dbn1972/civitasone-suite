import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.self-service.consumer" });
const AUDIT = "audit.event.record";

export function registerSelfServiceConsumers(queue: Queue): void {
  queue.subscribe("hrms.self_service.profile_update", async (msg) => {
    const p = msg.payload as { employeeId: string; tenantId: string; fields: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.self_service.profile_updated",
        eventType: "hrms.self_service.profile_updated",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { employeeId: p.employeeId, fields: Object.keys(p.fields) },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "self_service_profile_update", resourceType: "employee", resourceId: p.employeeId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:self_service:*`);
    log.info({ id: msg.messageId, employeeId: p.employeeId }, "Processed self_service.profile_update");
  });
}
