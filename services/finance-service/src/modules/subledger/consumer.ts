import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.subledger.consumer" });

export function registerSubledgerConsumers(queue: Queue): void {
  queue.subscribe("finance.subledger.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string; side?: "ap" | "ar" };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
    });
    await cache.invalidate(`finance:${p.tenantId}:subledger:*`);
    log.info({ id: msg.messageId, side: p.side }, "Processed subledger.refresh");
  });
}
