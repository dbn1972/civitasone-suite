import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.reports.consumer" });
const AUDIT = "audit.event.record";

export function registerReportsConsumers(queue: Queue): void {
  queue.subscribe("hrms.report.generate", async (msg) => {
    const p = msg.payload as { tenantId: string; reportType: string; params: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.report.generated",
        eventType: "hrms.report.generated",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId, reportType: p.reportType },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "report_generate", resourceType: "report", resourceId: msg.messageId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:reports:*`);
    log.info({ id: msg.messageId, reportType: p.reportType }, "Processed report.generate");
  });
}
