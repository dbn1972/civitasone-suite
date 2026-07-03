import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "pay-matrix-consumer" });
const AUDIT = "audit.event.record";

export function registerPayMatrixConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.payMatrixIncrement, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      effectiveDate: string;
      dryRun: boolean;
      processedCount?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "annual_increment",
          resourceType: "pay_matrix",
          resourceId: p.id,
          effectiveDate: p.effectiveDate,
          dryRun: p.dryRun,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pay_matrix", "increment_run"));
    log.info({ messageId: msg.messageId, effectiveDate: p.effectiveDate }, "pay matrix annual increment processed");
  });

  log.info("pay-matrix consumers registered");
}
