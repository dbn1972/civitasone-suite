import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { encryptPii } from "../../shared/pii-crypto.js";

const log = pino({ name: "finance.tds.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerTdsConsumers(queue: Queue): void {
  queue.subscribe("finance.tds.deduction_record", async (msg) => {
    const p = msg.payload as {
      id?: string; tenantId: string; vendorId: string; vendorName?: string;
      pan?: string; billId?: string; paymentId?: string; section?: string;
      grossAmountMinor: number; tdsRatePct: number; tdsAmountMinor: number;
      surchargeMinor?: number; cessMinor?: number; netPaymentMinor: number;
      deductionDate: string; quarter: string; fy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { sql } = await import("drizzle-orm");
      const encryptedPan = p.pan ? encryptPii(p.pan) : null;
      const rows = await (tx as any).execute(sql`
        INSERT INTO gl.finance_vendor_tds (
          tenant_id, vendor_id, vendor_name, pan, bill_id, payment_id, section,
          gross_amount_minor, tds_rate_pct, tds_amount_minor, surcharge_minor,
          cess_minor, net_payment_minor, deduction_date, quarter, fy
        ) VALUES (
          ${p.tenantId}::uuid, ${p.vendorId}::uuid, ${p.vendorName ?? null},
          ${encryptedPan}, ${p.billId ?? null}::uuid, ${p.paymentId ?? null}::uuid,
          ${p.section ?? "194C"}, ${p.grossAmountMinor}::bigint, ${p.tdsRatePct},
          ${p.tdsAmountMinor}::bigint, ${p.surchargeMinor ?? 0}::bigint,
          ${p.cessMinor ?? 0}::bigint, ${p.netPaymentMinor}::bigint,
          ${p.deductionDate}::date, ${p.quarter}, ${p.fy}
        )
        RETURNING id
      `);
      const id = (rows as any)[0]?.id ?? msg.messageId;
      await enqueue(tx, {
        topic: "finance.tds.deduction_recorded", eventType: "finance.tds.deduction_recorded",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, vendorId: p.vendorId, tdsAmountMinor: p.tdsAmountMinor, section: p.section ?? "194C" },
      });
      await audit(tx, msg, "record_deduction", "vendor_tds", id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:tds:*`);
    log.info({ id: msg.messageId }, "Processed tds.deduction_record");
  });

  queue.subscribe("finance.tds.deposit_mark", async (msg) => {
    const p = msg.payload as {
      tenantId: string; id: string; depositDate: string; challanNo: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { sql } = await import("drizzle-orm");
      await (tx as any).execute(sql`
        UPDATE gl.finance_vendor_tds
        SET deposit_date = ${p.depositDate}::date,
            challan_no = ${p.challanNo},
            status = 'deposited'
        WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid
      `);
      await enqueue(tx, {
        topic: "finance.tds.deposited", eventType: "finance.tds.deposited",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, challanNo: p.challanNo },
      });
      await audit(tx, msg, "mark_deposited", "vendor_tds", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:tds:*`);
    log.info({ id: msg.messageId }, "Processed tds.deposit_mark");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
