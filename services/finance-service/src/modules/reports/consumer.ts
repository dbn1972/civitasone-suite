import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.reports.consumer" });

export function registerReportsConsumers(queue: Queue): void {
  queue.subscribe("finance.reports.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string; reportType?: string; fy?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
    });
    await cache.invalidate(`finance:${p.tenantId}:reports:*`);
    log.info({ id: msg.messageId, reportType: p.reportType }, "Processed reports.refresh");
  });
}
