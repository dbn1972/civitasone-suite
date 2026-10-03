import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { encryptPii } from "../../shared/pii-crypto.js";
import { COMMANDS } from "../../topics.js";
import { enqueueSpineJournal } from "../gl/spine.js";

const log = pino({ name: "finance.tds.consumer" });

const AUDIT_TOPIC = "audit.event.record";
const TDS_EXPENSE_CODE = process.env.FINANCE_TDS_EXPENSE_CODE ?? "6100";
const TDS_PAYABLE_CODE = process.env.FINANCE_TDS_PAYABLE_CODE ?? "2200";

export function registerTdsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.tdsDeductionRecord, async (msg) => {
    const p = msg.payload as {
      id?: string; tenantId: string; vendorId: string; vendorName?: string;
      pan?: string; billId?: string; paymentId?: string; section?: string;
      grossAmountMinor: number; tdsRatePct: number; tdsAmountMinor: number;
      surchargeMinor?: number; cessMinor?: number; netPaymentMinor: number;
      deductionDate: string; quarter: string; fy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const expectedTds = BigInt(p.grossAmountMinor) * BigInt(Math.round(p.tdsRatePct * 100)) / 10000n;
      const diff = expectedTds > BigInt(p.tdsAmountMinor)
        ? expectedTds - BigInt(p.tdsAmountMinor)
        : BigInt(p.tdsAmountMinor) - expectedTds;
      if (diff > 1n) {
        throw new NonRetryableError(
          `TDS_AMOUNT_MISMATCH: declared ${p.tdsAmountMinor} paise ≠ computed ${expectedTds} paise at ${p.tdsRatePct}%`
        );
      }
      const { sql } = await import("drizzle-orm");
      const encryptedPan = p.pan ? encryptPii(p.pan) : null;
      const id = p.id ?? msg.messageId;
      await (tx as any).execute(sql`
        INSERT INTO gl.finance_vendor_tds (
          id, tenant_id, vendor_id, vendor_name, pan, bill_id, payment_id, section,
          gross_amount_minor, tds_rate_pct, tds_amount_minor, surcharge_minor,
          cess_minor, net_payment_minor, deduction_date, quarter, fy
        ) VALUES (
          ${id}::uuid, ${p.tenantId}::uuid, ${p.vendorId}::uuid, ${p.vendorName ?? null},
          ${encryptedPan}, ${p.billId ?? null}::uuid, ${p.paymentId ?? null}::uuid,
          ${p.section ?? "194C"}, ${p.grossAmountMinor}::bigint, ${p.tdsRatePct},
          ${p.tdsAmountMinor}::bigint, ${p.surchargeMinor ?? 0}::bigint,
          ${p.cessMinor ?? 0}::bigint, ${p.netPaymentMinor}::bigint,
          ${p.deductionDate}::date, ${p.quarter}, ${p.fy}
        )
        ON CONFLICT (id) DO NOTHING
      `);
      await enqueueSpineJournal(tx as Parameters<typeof enqueueSpineJournal>[0], {
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        sourceKey: `tds:${id}`,
        type: "tds",
        postingDate: p.deductionDate,
        lines: [
          { accountCode: TDS_EXPENSE_CODE, debitMinor: BigInt(p.tdsAmountMinor), creditMinor: 0n },
          { accountCode: TDS_PAYABLE_CODE, debitMinor: 0n, creditMinor: BigInt(p.tdsAmountMinor) },
        ],
      });
      await enqueue(tx, {
        topic: "finance.tds.deduction_recorded", eventType: "finance.tds.deduction_recorded",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, vendorId: p.vendorId, tdsAmountMinor: p.tdsAmountMinor, section: p.section ?? "194C" },
      });
      await audit(tx, msg, "record_deduction", "vendor_tds", id);
    });
    await cache.invalidateResource(msg.tenantId, "tds");
    log.info({ id: msg.messageId }, "Processed tds.deduction_record");
  });

  queue.subscribe(COMMANDS.tdsDepositMark, async (msg) => {
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
    await cache.invalidateResource(msg.tenantId, "tds");
    log.info({ id: msg.messageId }, "Processed tds.deposit_mark");
  });

  // GAP-FINANCE-STATUTORY-TDS-RETURNS-04: record a quarterly return as filed.
  // The unique (tenant, fy, quarter, form) key makes this race-safe: of two
  // concurrent recordings exactly one INSERT wins, the other is a no-op and
  // writes neither a second filing nor a second audit event.
  queue.subscribe(COMMANDS.tdsReturnFile, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; fy: string; quarter: string; formType: string;
      ackNo: string; filedOn: string; dueDate: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { sql } = await import("drizzle-orm");
      const inserted = (await (tx as any).execute(sql`
        INSERT INTO gl.finance_tds_return_filings
          (id, tenant_id, fy, quarter, form_type, due_date, status, ack_no, filed_on, filed_by)
        VALUES
          (${p.id}::uuid, ${p.tenantId}::uuid, ${p.fy}, ${p.quarter}, ${p.formType}, ${p.dueDate}::date,
           'filed', ${p.ackNo}, ${p.filedOn}::date, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id, fy, quarter, form_type) DO NOTHING
        RETURNING id
      `)) as unknown as unknown[];
      if (inserted.length === 0) {
        log.warn({ fy: p.fy, quarter: p.quarter }, "tds.return_file ignored: quarter already filed");
        return;
      }
      // Deposited deductions of the quarter now count as filed; anything still
      // 'deducted' (not yet deposited) keeps its status so the gap stays visible.
      await (tx as any).execute(sql`
        UPDATE gl.finance_vendor_tds SET status = 'filed'
        WHERE tenant_id = ${p.tenantId}::uuid AND fy = ${p.fy} AND quarter = ${p.quarter} AND status = 'deposited'
      `);
      await audit(tx, msg, "file_return", "tds_return", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "tds");
    log.info({ id: msg.messageId }, "Processed tds.return_file");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
