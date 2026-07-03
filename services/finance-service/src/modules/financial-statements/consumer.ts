import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.financial-statements.consumer" });

export function registerFinancialStatementsConsumers(queue: Queue): void {
  queue.subscribe("finance.financial_statements.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string; fy?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
    });
    await cache.invalidate(`finance:${p.tenantId}:financial_statements:*`);
    log.info({ id: msg.messageId }, "Processed financial_statements.refresh");
  });
}
