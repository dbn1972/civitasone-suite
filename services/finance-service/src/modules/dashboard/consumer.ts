import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.dashboard.consumer" });

export function registerDashboardConsumers(queue: Queue): void {
  queue.subscribe("finance.dashboard.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
    });
    await cache.invalidate(`finance:${p.tenantId}:dashboard:*`);
    log.info({ id: msg.messageId }, "Processed dashboard.refresh");
  });
}
