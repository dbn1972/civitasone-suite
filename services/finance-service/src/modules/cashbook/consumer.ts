import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.cashbook.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerCashbookConsumers(queue: Queue): void {
  queue.subscribe("finance.cashbook.entry_create", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; entryDate: string; voucherType: string;
      voucherNo: string; particulars: string; receiptMinor: number;
      paymentMinor: number; bankOrCash: string; reference?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { sql } = await import("drizzle-orm");
      await (tx as any).execute(sql`
        INSERT INTO gl.finance_cash_book (
          tenant_id, entry_date, voucher_type, voucher_no, particulars,
          receipt_minor, payment_minor, bank_or_cash, reference, created_by
        ) VALUES (
          ${p.tenantId}::uuid, ${p.entryDate}::date, ${p.voucherType},
          ${p.voucherNo}, ${p.particulars}, ${p.receiptMinor}::bigint,
          ${p.paymentMinor}::bigint, ${p.bankOrCash}, ${p.reference ?? null},
          ${msg.actorId}::uuid
        )
      `);
      await enqueue(tx, {
        topic: "finance.cashbook.entry_created", eventType: "finance.cashbook.entry_created",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { entryId: p.id, voucherNo: p.voucherNo },
      });
      await audit(tx, msg, "create_entry", "cashbook", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:cashbook:*`);
    log.info({ id: msg.messageId }, "Processed cashbook.entry_create");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
