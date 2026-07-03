import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.reports.consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerReportsConsumers(queue: Queue): void {
  queue.subscribe("finance.reports.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string; reportType?: string; fy?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "finance", action: "reports_refresh", resourceType: "report", resourceId: p.reportType ?? msg.tenantId, outcome: "success" },
      });
    });
    await cache.invalidate(`finance:${p.tenantId}:reports:*`);
    log.info({ id: msg.messageId, reportType: p.reportType }, "Processed reports.refresh");
  });
}
