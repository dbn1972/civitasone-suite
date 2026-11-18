import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { GST_LEDGER_EXPORT_TOPIC, RCM_ITC_CLAIM_TOPIC } from "./commands.js";
import { isValidGstRate } from "./gst-rates.js";
import { slabsEffectiveOn } from "./rate-master.js";
import { assertGstEnabledTx } from "./producer.js";
import { enqueueSpineJournal } from "../gl/spine.js";
import { GST_ITC_HEAD_CODE, RCM_ITC_PENDING_CODE, type GstTaxType } from "../gl/gst-heads.js";
import { getPeriodStatusTx } from "../period-close/repo.js";

const log = pino({ name: "finance.gst.consumer" });

const AUDIT_TOPIC = "audit.event.record";

type Rows = Array<Record<string, unknown>>;
const rowsOf = (r: unknown): Rows => (Array.isArray(r) ? r : ((r as { rows?: unknown[] } | undefined)?.rows ?? [])) as Rows;

export function registerGstConsumers(queue: Queue): void {
  // GAP-FINANCE-GST-05: audit-on-export. Routes may not write to Postgres, so
  // the POST route only publishes this command and the audit row is enqueued here.
  queue.subscribe(GST_LEDGER_EXPORT_TOPIC, async (msg) => {
    const p = msg.payload as { id: string; period: string; rowCount: number; filtered?: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "finance", action: "export", resourceType: "gst_ledger", resourceId: p.period,
          outcome: "success", rowCount: p.rowCount, filtered: p.filtered === true,
        },
      });
    });
    log.info({ id: msg.messageId }, "Processed gst ledger export audit");
  });

  queue.subscribe("finance.gst.entry_record", async (msg) => {
    const p = msg.payload as {
      op?: "rcm_claim";
      id: string; tenantId: string; invoiceId?: string; invoiceNo: string;
      invoiceDate: string; partyGstin: string | null; partyName?: string | null;
      gstType: string; direction: "input" | "output"; taxableMinor: number | string;
      taxMinor: number | string; ratePct: number; hsnCode?: string; period: string;
      // MSME M3a (all optional: legacy producers send none)
      sourceDocType?: string; sourceDocId?: string; journalId?: string; ledgerVoucherNo?: string;
      itcCategory?: "eligible" | "ineligible" | "blocked"; rcm?: boolean; glHeadCode?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // MSME M3a defense in depth: the producer already gated on settings in ITS tx; refuse here too for a tenant that is not
      // GST-registered on a commercial chart (NonRetryable: a retry cannot make it registered). Nothing is written.
      await assertGstEnabledTx(tx, msg.tenantId);
      const { sql } = await import("drizzle-orm");
      if (p.op === "rcm_claim") {
        // The RCM tax was paid and the claim journal posted (same tx as this message's emission): re-point the pending rows.
        await (tx as any).execute(sql`
          UPDATE gl.finance_gst_ledger
             SET gl_head_code = CASE gst_type WHEN 'IGST' THEN ${GST_ITC_HEAD_CODE.IGST} WHEN 'CGST' THEN ${GST_ITC_HEAD_CODE.CGST}
                                              WHEN 'SGST' THEN ${GST_ITC_HEAD_CODE.SGST} ELSE ${GST_ITC_HEAD_CODE.CESS} END,
                 rcm_itc_claimed_at = now()
           WHERE tenant_id = ${msg.tenantId}::uuid AND source_doc_type = ${p.sourceDocType ?? "bill"} AND source_doc_id = ${p.sourceDocId}::uuid
             AND rcm = true AND itc_category = 'eligible' AND gl_head_code = ${RCM_ITC_PENDING_CODE}`);
        await audit(tx, msg, "rcm_itc_claim", "gst_ledger", String(p.sourceDocId));
        return;
      }
      // DOM-013 + MSME M3a: the slab check reads the EFFECTIVE-DATED rate master as of the invoice date (not a hard-coded list):
      // CGST/SGST against half a slab, IGST against a full slab (see gst-rates.ts).
      const slabs = await slabsEffectiveOn(tx, p.invoiceDate, p.hsnCode ?? null);
      if (!isValidGstRate(p.ratePct, p.gstType, slabs)) {
        throw new NonRetryableError(
          `GST_RATE_INVALID: ${p.ratePct}% is not a valid ${p.gstType} rate on ${p.invoiceDate} (slabs in force: ${slabs.join(", ")}; CGST/SGST use half the slab)`
        );
      }
      const hasSource = p.sourceDocId != null;
      const inserted = rowsOf(await (tx as any).execute(sql`
        INSERT INTO gl.finance_gst_ledger (
          tenant_id, invoice_id, invoice_no, invoice_date, party_gstin, party_name,
          gst_type, direction, taxable_minor, tax_minor, rate_pct, hsn_code, period, created_by,
          source_doc_type, source_doc_id, journal_id, ledger_voucher_no, itc_category, rcm, gl_head_code
        ) VALUES (
          ${p.tenantId}::uuid, ${p.invoiceId ?? null}::uuid, ${p.invoiceNo},
          ${p.invoiceDate}::date, ${p.partyGstin ?? null}, ${p.partyName ?? null},
          ${p.gstType}, ${p.direction}, ${String(p.taxableMinor)}::bigint,
          ${String(p.taxMinor)}::bigint, ${p.ratePct}, ${p.hsnCode ?? null}, ${p.period},
          ${msg.actorId}::uuid,
          ${p.sourceDocType ?? null}, ${p.sourceDocId ?? null}::uuid, ${p.journalId ?? null}::uuid, ${p.ledgerVoucherNo ?? null},
          ${p.itcCategory ?? null}, ${p.rcm === true}, ${p.glHeadCode ?? null}
        )
        ON CONFLICT (tenant_id, source_doc_type, source_doc_id, gst_type, direction, rate_pct) WHERE source_doc_id IS NOT NULL DO NOTHING
        RETURNING id
      `));
      // A re-delivery of an already-recorded source-document line is a no-op (the unique key held): no second row, no second event.
      if (hasSource && inserted.length === 0) return;
      await enqueue(tx, {
        topic: "finance.gst.entry_recorded", eventType: "finance.gst.entry_recorded",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { invoiceNo: p.invoiceNo, gstType: p.gstType, direction: p.direction, taxMinor: p.taxMinor },
      });
      await audit(tx, msg, "record_entry", "gst_ledger", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "gst");
    log.info({ id: msg.messageId }, "Processed gst.entry_record");
  });

  // MSME M3a: ITC on reverse-charge tax becomes claimable once the RCM tax is PAID. Moves the pending ITC to the per-tax ITC heads:
  // Dr per-tax ITC / Cr ITC-RCM-pending, via the normal GL spine; the GL hook then re-points the ledger rows in the same posting tx.
  queue.subscribe(RCM_ITC_CLAIM_TOPIC, async (msg) => {
    const p = msg.payload as { id: string; billId: string; paidOn: string; challanRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await assertGstEnabledTx(tx, msg.tenantId);
      const period = p.paidOn.slice(0, 7);
      const st = await getPeriodStatusTx(tx, msg.tenantId, period);
      if (st === "hard_close" || st === "soft_close") throw new NonRetryableError(`PERIOD_CLOSED: ${period} is ${st}; the RCM ITC claim cannot be posted`);
      const { sql } = await import("drizzle-orm");
      const pend = rowsOf(await (tx as any).execute(sql`
        SELECT gst_type, SUM(tax_minor)::text AS tax
          FROM gl.finance_gst_ledger
         WHERE tenant_id = ${msg.tenantId}::uuid AND source_doc_type = 'bill' AND source_doc_id = ${p.billId}::uuid
           AND rcm = true AND itc_category = 'eligible' AND gl_head_code = ${RCM_ITC_PENDING_CODE} AND rcm_itc_claimed_at IS NULL
         GROUP BY gst_type ORDER BY gst_type`));
      if (pend.length === 0) throw new NonRetryableError(`GST_RCM_NOTHING_TO_CLAIM: bill ${p.billId} has no pending reverse-charge ITC (already claimed, not RCM, or its GST rows are not recorded yet)`);
      let total = 0n;
      const lines: Array<{ accountCode: string; debitMinor: bigint; creditMinor: bigint; narration: string }> = pend.map((r) => {
        const amt = BigInt(String(r.tax)); total += amt;
        return { accountCode: GST_ITC_HEAD_CODE[String(r.gst_type) as GstTaxType], debitMinor: amt, creditMinor: 0n, narration: `RCM ITC claim ${String(r.gst_type)} (paid ${p.paidOn}, ${p.challanRef})` };
      });
      lines.push({ accountCode: RCM_ITC_PENDING_CODE, debitMinor: 0n, creditMinor: total, narration: "RCM ITC moved from pending" });
      await enqueueSpineJournal(tx, {
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        sourceKey: `rcm-claim:${p.billId}`, type: "journal", postingDate: p.paidOn, lines,
        extra: { gst: { sourceDocType: "bill", sourceDocId: p.billId, invoiceNo: p.challanRef, invoiceDate: p.paidOn, rcmClaimOf: p.billId } },
      });
      await audit(tx, msg, "rcm_itc_claim_requested", "bill", p.billId);
    });
    log.info({ id: msg.messageId }, "Processed gst.rcm_itc_claim");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
