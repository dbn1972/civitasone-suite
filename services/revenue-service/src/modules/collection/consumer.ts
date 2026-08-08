import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { receipts, refunds, adjustments } from "./schema.js";
import { dcbEntries } from "../assessment/schema.js";
import { validateReceipt, validateRefund, validateAdjustment, assertMakerChecker } from "./domain.js";
import { getDemandBalance } from "./repo.js";
import { eq, and } from "drizzle-orm";

export function registerCollectionConsumers(queue: Queue): void {
  // ── receiptCreate ───────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.receiptCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assesseeId, demandId, amountMinor, channel, reference, instrumentNo, bankName } =
        msg.payload as {
          assesseeId: string;
          demandId: string;
          amountMinor: string;
          channel: string;
          reference: string;
          instrumentNo?: string;
          bankName?: string;
        };

      const amount = BigInt(amountMinor);

      // Load demand balance
      const balance = await getDemandBalance(msg.tenantId, demandId);

      // Domain validation
      validateReceipt(
        { assesseeId, demandId, amountMinor: amount, channel: channel as "online" | "counter" | "cheque" | "dd" | "pos" },
        balance,
      );

      // Insert receipt
      const receiptRows = await tx.insert(receipts).values({
        tenantId: msg.tenantId,
        assesseeId,
        demandId,
        amountMinor: amount,
        channel,
        reference,
        instrumentNo: instrumentNo ?? null,
        bankName: bankName ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      }).returning({ id: receipts.id });
      const receiptId = receiptRows[0]?.id ?? reference;

      // Insert DCB entry (type: collection)
      const newBalance = balance - amount;
      await tx.insert(dcbEntries).values({
        tenantId: msg.tenantId,
        assesseeId,
        demandId,
        entryType: "collection",
        amountMinor: amount,
        balanceMinor: newBalance,
        referenceId: receiptId,
        referenceType: "receipt",
        narration: `Receipt collected via ${channel}`,
        createdBy: msg.actorId,
      });

      // Enqueue outbox events (receiptId required by finance GL consumer)
      await enqueue(tx, {
        topic: EVENTS.receiptCaptured,
        eventType: EVENTS.receiptCaptured,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { receiptId, assesseeId, demandId, amountMinor: amountMinor, channel },
      });
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "create", resourceType: "receipt", outcome: "success" },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:receipts:${(msg.payload as { assesseeId: string }).assesseeId}`);
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:dcb:${(msg.payload as { assesseeId: string }).assesseeId}`);
  });

  // ── refundCreate ────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.refundCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { receiptId, reason } = msg.payload as { receiptId: string; reason: string };

      // Load the original receipt to get its amount
      const receiptRows = await tx
        .select()
        .from(receipts)
        .where(and(eq(receipts.tenantId, msg.tenantId), eq(receipts.id, receiptId)))
        .limit(1);
      const receipt = receiptRows[0];
      if (!receipt) return;

      // Domain validation
      validateRefund(receipt.amountMinor, receipt.amountMinor);

      // Insert refund (status: pending, makerUserId: actorId)
      await tx.insert(refunds).values({
        tenantId: msg.tenantId,
        receiptId,
        assesseeId: receipt.assesseeId,
        amountMinor: receipt.amountMinor,
        reason,
        status: "pending",
        makerUserId: msg.actorId,
      });

      // Audit
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "create", resourceType: "refund", outcome: "success" },
      });
    });
  });

  // ── refundDecide ────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.refundDecide, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { refundId, approve, reason } = msg.payload as {
        refundId: string;
        approve: boolean;
        reason?: string;
      };

      // Load refund
      const refundRows = await tx
        .select()
        .from(refunds)
        .where(and(eq(refunds.tenantId, msg.tenantId), eq(refunds.id, refundId)))
        .limit(1);
      const refund = refundRows[0];
      if (!refund) return;

      // Maker-checker enforcement
      assertMakerChecker(refund.makerUserId, msg.actorId);

      const newStatus = approve ? "approved" : "rejected";
      await tx
        .update(refunds)
        .set({ status: newStatus, checkerUserId: msg.actorId, decidedAt: new Date() })
        .where(eq(refunds.id, refundId));

      if (approve) {
        // Insert DCB entry (type: refund) — balance increases by refund amount
        const balance = await getDemandBalance(msg.tenantId, refund.assesseeId);
        const newBalance = balance + refund.amountMinor;
        await tx.insert(dcbEntries).values({
          tenantId: msg.tenantId,
          assesseeId: refund.assesseeId,
          demandId: refund.assesseeId, // linked through receipt's demand
          entryType: "refund",
          amountMinor: refund.amountMinor,
          balanceMinor: newBalance,
          referenceId: refundId,
          referenceType: "refund",
          narration: `Refund approved: ${reason ?? refund.reason}`,
          createdBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.refundProcessed,
          eventType: EVENTS.refundProcessed,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { refundId, assesseeId: refund.assesseeId, amountMinor: refund.amountMinor.toString() },
        });
      }

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "decide", resourceType: "refund", outcome: newStatus },
      });
    });

    const payload = msg.payload as { refundId: string };
    // Invalidate caches
    const refundRows = await db
      .select({ assesseeId: refunds.assesseeId })
      .from(refunds)
      .where(eq(refunds.id, payload.refundId))
      .limit(1);
    const assesseeId = refundRows[0]?.assesseeId;
    if (assesseeId) {
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:receipts:${assesseeId}`);
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:dcb:${assesseeId}`);
    }
  });

  // ── adjustmentCreate ────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.adjustmentCreate, async (msg) => {
    const { assesseeId, fromDemandId, toDemandId, amountMinor, reason } = msg.payload as {
      assesseeId: string;
      fromDemandId: string;
      toDemandId: string;
      amountMinor: string;
      reason: string;
    };

    const amount = BigInt(amountMinor);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load from-demand balance
      const fromBalance = await getDemandBalance(msg.tenantId, fromDemandId);

      // Domain validation
      validateAdjustment({ assesseeId, fromDemandId, toDemandId, amountMinor: amount, reason }, fromBalance);

      // Insert adjustment
      await tx.insert(adjustments).values({
        tenantId: msg.tenantId,
        assesseeId,
        fromDemandId,
        toDemandId,
        amountMinor: amount,
        reason,
        createdBy: msg.actorId,
      });

      // Insert DCB entry: debit source (reduce balance)
      const newFromBalance = fromBalance - amount;
      await tx.insert(dcbEntries).values({
        tenantId: msg.tenantId,
        assesseeId,
        demandId: fromDemandId,
        entryType: "adjustment",
        amountMinor: amount,
        balanceMinor: newFromBalance,
        referenceType: "adjustment",
        narration: `Adjustment debit: ${reason}`,
        createdBy: msg.actorId,
      });

      // Insert DCB entry: credit target (increase balance)
      const toBalance = await getDemandBalance(msg.tenantId, toDemandId);
      const newToBalance = toBalance + amount;
      await tx.insert(dcbEntries).values({
        tenantId: msg.tenantId,
        assesseeId,
        demandId: toDemandId,
        entryType: "adjustment",
        amountMinor: amount,
        balanceMinor: newToBalance,
        referenceType: "adjustment",
        narration: `Adjustment credit: ${reason}`,
        createdBy: msg.actorId,
      });

      // Enqueue outbox events
      await enqueue(tx, {
        topic: EVENTS.adjustmentApplied,
        eventType: EVENTS.adjustmentApplied,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { assesseeId, fromDemandId, toDemandId, amountMinor, reason },
      });
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "create", resourceType: "adjustment", outcome: "success" },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:receipts:${assesseeId}`);
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:dcb:${assesseeId}`);
  });
}
