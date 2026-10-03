/**
 * Filing-record consumer: inbox dedup -> INSERT .. ON CONFLICT DO NOTHING ->
 * outbox event + audit, one transaction. The unique indexes (revision, receipt
 * number) are the race-safe arbiter: a command that loses a race inserts
 * nothing and is audited as a failure.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import type { FilingInput } from "./routes.js";

const AUDIT = "audit.event.record";

export function registerReturnFilingConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.returnFilingRecord, async (msg) => {
    const p = msg.payload as FilingInput & { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = (await tx.execute(sql`
        INSERT INTO payroll.statutory_return_filings
          (id, tenant_id, form_type, fy, quarter, filed_on, receipt_no, revision, note, recorded_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.formType}, ${p.fy}, ${p.quarter}, ${p.filedOn}::date,
                ${p.receiptNo}, ${p.revision}, ${p.note ?? null}, ${msg.actorId}::uuid)
        ON CONFLICT DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      const ok = inserted.length === 1;
      if (ok) {
        await enqueue(tx, {
          topic: EVENTS.returnFilingRecorded, eventType: EVENTS.returnFilingRecorded,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, formType: p.formType, fy: p.fy, quarter: p.quarter, revision: p.revision },
        });
      }
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "payroll", action: "return_filing_recorded", resourceType: "statutory_return", resourceId: `${p.formType}:${p.fy}:${p.quarter}:${p.revision}`,
          outcome: ok ? "success" : "failure",
          detail: { filedOn: p.filedOn, receiptNo: p.receiptNo, ...(ok ? {} : { code: "DUPLICATE" }) },
        },
      });
    });
  });
}
