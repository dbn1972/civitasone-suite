import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { payrollTdsChallan } from "../statutory/schema.js";

const log = pino({ name: "payroll-challan-consumer" });
const AUDIT = "audit.event.record";

export function registerChallanConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.tdsChallanIngest, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      period: string;
      bsrCode: string;
      challanSerial: string;
      depositDate: string;
      section: string;
      formType: string;
      cin: string;
      tdsAmountMinor: string;
      totalAmountMinor: string;
      interestMinor: string;
      feeMinor: string;
    };

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const inserted = await tx
          .insert(payrollTdsChallan)
          .values({
            id: p.id,
            tenantId: p.tenantId,
            period: p.period,
            section: p.section,
            formType: p.formType,
            bsrCode: p.bsrCode,
            challanSerial: p.challanSerial,
            depositDate: p.depositDate,
            cin: p.cin,
            tdsAmountMinor: BigInt(p.tdsAmountMinor),
            totalAmountMinor: BigInt(p.totalAmountMinor),
            interestMinor: BigInt(p.interestMinor),
            feeMinor: BigInt(p.feeMinor),
            createdBy: msg.actorId,
          })
          .onConflictDoNothing({ target: [payrollTdsChallan.tenantId, payrollTdsChallan.cin] })
          .returning();

        if (inserted.length === 0) return;

        await enqueue(tx, {
          topic: EVENTS.tdsChallanIngested,
          eventType: EVENTS.tdsChallanIngested,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { id: p.id, cin: p.cin, period: p.period, formType: p.formType },
        });
        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "ingest",
            resourceType: "tds_challan",
            resourceId: p.cin,
            outcome: "success",
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "tdsChallanIngest failed");
      throw err;
    }
  });
}
