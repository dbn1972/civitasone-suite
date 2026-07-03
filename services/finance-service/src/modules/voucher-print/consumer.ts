import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.voucher-print.consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerVoucherPrintConsumers(queue: Queue): void {
  queue.subscribe("finance.voucher_print.generate", async (msg) => {
    const p = msg.payload as { tenantId: string; journalId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "finance", action: "voucher_print_generate", resourceType: "voucher", resourceId: p.journalId, outcome: "success" },
      });
    });
    await cache.invalidate(`finance:${p.tenantId}:voucher_print:*`);
    log.info({ id: msg.messageId, journalId: p.journalId }, "Processed voucher_print.generate");
  });
}
