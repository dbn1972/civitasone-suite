import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.voucher-print.consumer" });

export function registerVoucherPrintConsumers(queue: Queue): void {
  queue.subscribe("finance.voucher_print.generate", async (msg) => {
    const p = msg.payload as { tenantId: string; journalId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
    });
    await cache.invalidate(`finance:${p.tenantId}:voucher_print:*`);
    log.info({ id: msg.messageId, journalId: p.journalId }, "Processed voucher_print.generate");
  });
}
