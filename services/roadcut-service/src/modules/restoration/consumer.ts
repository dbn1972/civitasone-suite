import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "roadcut.restoration.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRestorationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.startRestoration, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; permitId: string; startDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRestoration(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        restorationStartDate: p.startDate,
        quality: "pending",
        depositRefundStatus: "held",
        currency: "INR",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.restorationStarted,
        eventType: EVENTS.restorationStarted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { restorationId: p.id, permitId: p.permitId, startDate: p.startDate },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "restoration.start",
        resourceType: "roadcut_restoration",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, permitId: p.permitId }, "restoration started");
  });

  queue.subscribe(COMMANDS.completeRestoration, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; quality: string; endDate: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // repo.completeRestoration now only applies while quality is still
      // "pending" (see repo.ts) — a losing racer against a concurrent
      // /complete call returns false here and must not publish a completed
      // event or audit entry for a write that didn't happen.
      const ok = await repo.completeRestoration(tx, p.id, msg.tenantId, p.quality, p.endDate, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.restorationCompleted,
        eventType: EVENTS.restorationCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { restorationId: p.id, quality: p.quality },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "restoration.complete",
        resourceType: "roadcut_restoration",
        resourceId: p.id,
      });
    });
    if (applied) log.info({ id: p.id, quality: p.quality }, "restoration completed");
  });

  queue.subscribe(COMMANDS.decideDepositRefund, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: string; refundMinor?: string };
    const refundAmount = p.refundMinor ? BigInt(p.refundMinor) : 0n;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // repo.updateDepositRefund now only applies while depositRefundStatus is
      // still "held" (see repo.ts) — a losing racer against a concurrent
      // /refund call returns false here and must not publish a decided event
      // or audit entry for a write that didn't happen.
      const ok = await repo.updateDepositRefund(tx, p.id, msg.tenantId, p.decision, refundAmount, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.depositRefundDecided,
        eventType: EVENTS.depositRefundDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { restorationId: p.id, decision: p.decision, refundMinor: String(refundAmount) },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "deposit.decide",
        resourceType: "roadcut_restoration",
        resourceId: p.id,
      });
    });
    if (applied) log.info({ id: p.id, decision: p.decision }, "deposit refund decided");
  });
}
