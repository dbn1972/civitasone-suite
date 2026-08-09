import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "sewerage.billing.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerBillingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.billGenerate, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, connectionId: p.connectionId,
        billNumber: p.billNumber, billingPeriod: p.billingPeriod,
        amountMinor: p.amountMinor, dueDate: p.dueDate, status: "generated",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.billGenerated, eventType: EVENTS.billGenerated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { billId: p.id, billNumber: p.billNumber, connectionId: p.connectionId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "bill.generate", resourceType: "sewerage_bill", resourceId: p.id });
    });
    log.info({ id: p.id }, "bill generated");
  });

  queue.subscribe(COMMANDS.billPay, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "paid", paymentRef: p.paymentRef, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.billPaid, eventType: EVENTS.billPaid,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { billId: p.id, paymentRef: p.paymentRef },
      });
      await writeAudit(tx, ctxOf(msg), { action: "bill.pay", resourceType: "sewerage_bill", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "bill paid");
  });
}
