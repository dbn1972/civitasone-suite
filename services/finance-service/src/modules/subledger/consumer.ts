import { pino } from "pino";
import { sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "finance.subledger.consumer" });
const AUDIT_TOPIC = "audit.event.record";

type ExecTx = { execute: (q: unknown) => Promise<unknown> };
const rowsOf = (r: unknown): unknown[] => (Array.isArray(r) ? r : ((r as { rows?: unknown[] } | undefined)?.rows ?? []));

/**
 * B22 D5: gl.finance_ar_ledger had no writer anywhere, so the AR sub-ledger was always 0 while control account 1300
 * held every billing receivable (revenue-billing/consumer.ts debits 1300 on billing.invoice.issued and credits it on
 * billing.invoice.paid). Each of those two events now also reaches this handler, which keeps one row per billing
 * invoice (demand_id = the invoice id): open at the invoice total when issued, settled when paid. Idempotent per
 * invoice, in either order: an issued event for an invoice that already has a row (e.g. paid arrived first) is a no-op.
 */
export async function syncArLedger(
  tx: ExecTx, tenantId: string, p: { event: "issued" | "paid"; invoiceId: string; totalMinor: string; date: string },
): Promise<void> {
  const total = BigInt(p.totalMinor);
  if (p.event === "issued") {
    await tx.execute(sql`
      INSERT INTO gl.finance_ar_ledger (tenant_id, debtor_id, debtor_name, demand_id, invoice_date, amount_minor, received_minor, balance_minor, aging_bucket, status)
      SELECT ${tenantId}::uuid, ${tenantId}::uuid, 'Platform subscription billing', ${p.invoiceId}::uuid, ${p.date}::date, ${total}::bigint, 0, ${total}::bigint, '0-30', 'open'
      WHERE NOT EXISTS (SELECT 1 FROM gl.finance_ar_ledger WHERE tenant_id = ${tenantId}::uuid AND demand_id = ${p.invoiceId}::uuid)`);
    return;
  }
  const updated = rowsOf(await tx.execute(sql`
    UPDATE gl.finance_ar_ledger SET received_minor = amount_minor, balance_minor = 0, status = 'paid'
    WHERE tenant_id = ${tenantId}::uuid AND demand_id = ${p.invoiceId}::uuid AND status <> 'paid'
    RETURNING id`));
  if (updated.length > 0) return;
  await tx.execute(sql`
    INSERT INTO gl.finance_ar_ledger (tenant_id, debtor_id, debtor_name, demand_id, invoice_date, amount_minor, received_minor, balance_minor, aging_bucket, status)
    SELECT ${tenantId}::uuid, ${tenantId}::uuid, 'Platform subscription billing', ${p.invoiceId}::uuid, ${p.date}::date, ${total}::bigint, ${total}::bigint, 0, '0-30', 'paid'
    WHERE NOT EXISTS (SELECT 1 FROM gl.finance_ar_ledger WHERE tenant_id = ${tenantId}::uuid AND demand_id = ${p.invoiceId}::uuid)`);
}

export function registerSubledgerConsumers(queue: Queue): void {
  queue.subscribe("finance.subledger.refresh", async (msg) => {
    const p = msg.payload as { tenantId: string; side?: "ap" | "ar" };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "finance", action: "subledger_refresh", resourceType: "subledger", resourceId: p.side ?? msg.tenantId, outcome: "success" },
      });
    });
    await cache.invalidateResource(p.tenantId, "subledger");
    log.info({ id: msg.messageId, side: p.side }, "Processed subledger.refresh");
  });

  // B22 D5: billing invoice issued / paid -> AR sub-ledger.
  queue.subscribe(COMMANDS.arLedgerSync, async (msg) => {
    const p = msg.payload as { event: "issued" | "paid"; invoiceId: string; totalMinor: string; date: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await syncArLedger(tx as unknown as ExecTx, msg.tenantId, p);
    });
    await cache.invalidateResource(msg.tenantId, "subledger");
    log.info({ id: msg.messageId, event: p.event, invoiceId: p.invoiceId }, "AR sub-ledger synced from billing");
  });
}
