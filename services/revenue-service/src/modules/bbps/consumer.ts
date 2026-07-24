import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { bbpsTransactions } from "./schema.js";
import { receipts } from "../collection/schema.js";
import { dcbEntries } from "../assessment/schema.js";
import { buildFetchBillResponse, validateBbpsPayment } from "./domain.js";
import { getDcbOutstanding } from "./repo.js";

export function registerBbpsConsumers(queue: Queue): void {
  // ── bbpsFetchBill ─────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bbpsFetchBill, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assesseeIdentifier } = msg.payload as { assesseeIdentifier: string };

      // Get DCB outstanding for the assessee
      const dcb = await getDcbOutstanding(msg.tenantId, assesseeIdentifier);
      if (!dcb) return;

      // Build fetch-bill response (throws DomainError if no outstanding)
      const billDate = new Date().toISOString().slice(0, 10);
      const _response = buildFetchBillResponse(dcb, billDate);

      // Insert bbps_transaction with status: pending
      await tx.insert(bbpsTransactions).values({
        tenantId: msg.tenantId,
        bbpsTxnId: `FETCH-${msg.messageId.slice(0, 8)}`,
        assesseeId: dcb.assesseeId,
        amountMinor: dcb.totalOutstandingMinor,
        channel: "bbps",
        status: "pending",
      });

      // Audit
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "fetch_bill", resourceType: "bbps_transaction", outcome: "success" },
      });
    });
  });

  // ── bbpsPayBill ───────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bbpsPayBill, async (msg) => {
    const { assesseeIdentifier, amountMinor, bbpsTxnId, channel } = msg.payload as {
      assesseeIdentifier: string;
      amountMinor: string;
      bbpsTxnId: string;
      channel: string;
    };

    const paymentAmount = BigInt(amountMinor);
    let assesseeId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Get DCB outstanding
      const dcb = await getDcbOutstanding(msg.tenantId, assesseeIdentifier);
      if (!dcb) return;

      assesseeId = dcb.assesseeId;

      // Validate payment against outstanding
      validateBbpsPayment(paymentAmount, dcb.totalOutstandingMinor);

      // Insert receipt
      const receiptRows = await tx.insert(receipts).values({
        tenantId: msg.tenantId,
        assesseeId: dcb.assesseeId,
        demandId: dcb.assesseeId, // BBPS pays across all demands
        amountMinor: paymentAmount,
        channel,
        reference: bbpsTxnId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      }).returning({ id: receipts.id });

      const receiptId = receiptRows[0]?.id ?? null;

      // Insert DCB entry (collection)
      await tx.insert(dcbEntries).values({
        tenantId: msg.tenantId,
        assesseeId: dcb.assesseeId,
        demandId: dcb.assesseeId,
        entryType: "collection",
        amountMinor: paymentAmount,
        balanceMinor: dcb.totalOutstandingMinor - paymentAmount,
        referenceId: receiptId,
        referenceType: "receipt",
        narration: `BBPS payment via ${channel} (txn: ${bbpsTxnId})`,
        createdBy: msg.actorId,
      });

      // Update bbps_transaction status to success
      await tx.insert(bbpsTransactions).values({
        tenantId: msg.tenantId,
        bbpsTxnId,
        assesseeId: dcb.assesseeId,
        amountMinor: paymentAmount,
        channel,
        status: "success",
        receiptId,
      });

      // Enqueue receipt captured event
      await enqueue(tx, {
        topic: EVENTS.receiptCaptured,
        eventType: EVENTS.receiptCaptured,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { assesseeId: dcb.assesseeId, amountMinor, channel, bbpsTxnId },
      });

      // Audit
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "pay_bill", resourceType: "bbps_transaction", outcome: "success" },
      });
    });

    // Cache invalidation
    if (assesseeId) {
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:dcb:${assesseeId}`);
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:receipts:${assesseeId}`);
    }
  });
}
