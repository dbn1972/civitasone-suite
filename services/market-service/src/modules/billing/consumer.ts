import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "market.billing.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerBillingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.generateDemand, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      allotmentId: string;
      demandMonth: string;
      amountMinor: string;
      dueDate: string;
      lateFeeMinor?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDemand(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        allotmentId: p.allotmentId,
        demandMonth: p.demandMonth,
        amountMinor: BigInt(p.amountMinor),
        lateFeeMinor: p.lateFeeMinor ? BigInt(p.lateFeeMinor) : 0n,
        currency: "INR",
        dueDate: p.dueDate,
        status: "generated",
        paidAt: null,
        paymentRef: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.demandGenerated,
        eventType: EVENTS.demandGenerated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { demandId: p.id, allotmentId: p.allotmentId, demandMonth: p.demandMonth },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "demand.generate",
        resourceType: "market_demand",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, demandMonth: p.demandMonth }, "market demand generated");
  });

  queue.subscribe(COMMANDS.recordPayment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; paymentRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "paid", msg.actorId, {
        paidAt: new Date(),
        paymentRef: p.paymentRef,
      });
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.paymentRecorded,
        eventType: EVENTS.paymentRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { demandId: p.id, paymentRef: p.paymentRef },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "demand.pay",
        resourceType: "market_demand",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.waiveDemand, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "waived", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.demandWaived,
        eventType: EVENTS.demandWaived,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { demandId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "demand.waive",
        resourceType: "market_demand",
        resourceId: p.id,
      });
    });
  });
}
