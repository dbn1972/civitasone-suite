import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.gst.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerGstConsumers(queue: Queue): void {
  queue.subscribe("finance.gst.entry_record", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; invoiceId?: string; invoiceNo: string;
      invoiceDate: string; partyGstin: string; partyName?: string;
      gstType: string; direction: "input" | "output"; taxableMinor: number;
      taxMinor: number; ratePct: number; hsnCode?: string; period: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { sql } = await import("drizzle-orm");
      await (tx as any).execute(sql`
        INSERT INTO gl.finance_gst_ledger (
          tenant_id, invoice_id, invoice_no, invoice_date, party_gstin, party_name,
          gst_type, direction, taxable_minor, tax_minor, rate_pct, hsn_code, period, created_by
        ) VALUES (
          ${p.tenantId}::uuid, ${p.invoiceId ?? null}::uuid, ${p.invoiceNo},
          ${p.invoiceDate}::date, ${p.partyGstin}, ${p.partyName ?? null},
          ${p.gstType}, ${p.direction}, ${p.taxableMinor}::bigint,
          ${p.taxMinor}::bigint, ${p.ratePct}, ${p.hsnCode ?? null}, ${p.period},
          ${msg.actorId}::uuid
        )
      `);
      await enqueue(tx, {
        topic: "finance.gst.entry_recorded", eventType: "finance.gst.entry_recorded",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { invoiceNo: p.invoiceNo, gstType: p.gstType, direction: p.direction, taxMinor: p.taxMinor },
      });
      await audit(tx, msg, "record_entry", "gst_ledger", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:gst:*`);
    log.info({ id: msg.messageId }, "Processed gst.entry_record");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
