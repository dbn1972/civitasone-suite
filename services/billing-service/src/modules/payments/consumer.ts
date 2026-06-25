import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as invoiceRepo from "../invoices/repo.js";
import { assertPayable, assertWithinOutstanding } from "../invoices/domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerPaymentsConsumers(queue: Queue): void {
  queue.subscribe<{
    id: string; tenantId: string; invoiceId: string; amountMinor: number;
    method?: string; gateway: string; reference?: string;
  }>(COMMANDS.paymentRecord, async (msg) => {
    const p = msg.payload;
    const amount = BigInt(p.amountMinor);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // redelivery → no-op

      const inv = await invoiceRepo.findByIdTx(tx, p.invoiceId);
      if (!inv || inv.tenantId !== p.tenantId) throw new Error(`invoice ${p.invoiceId} not found`);

      // Domain guards: bill must be in a payable state and the receipt must not
      // exceed the outstanding balance (no over-payment).
      assertPayable(inv.status);
      assertWithinOutstanding(inv.totalMinor, inv.paidMinor, amount);

      // Record the receipt.
      const receiptNo = `RCPT-${new Date().getUTCFullYear()}-${p.id.slice(0, 8).toUpperCase()}`;
      await repo.insertPayment(tx, {
        id: p.id, tenantId: p.tenantId, invoiceId: p.invoiceId,
        amountMinor: amount, method: p.method ?? "gateway", status: "completed",
        receiptNo, ...(p.reference ? { reference: p.reference } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertGatewayTxn(tx, {
        id: randomUUID(), tenantId: p.tenantId, paymentId: p.id,
        gateway: p.gateway, status: "captured", createdBy: msg.actorId, updatedBy: msg.actorId,
      });

      // Atomically advance the bill (partially_paid / paid). The guarded UPDATE
      // re-checks payable-state + outstanding inside the tx; a row count of 0
      // means a concurrent/redelivered receipt already consumed the headroom.
      const updated = await invoiceRepo.applyPaymentGuarded(tx, p.invoiceId, amount, msg.actorId);
      if (!updated) throw new Error(`PAYMENT_NOT_APPLIED: bill ${p.invoiceId} not payable or overpaid`);

      await enqueue(tx, {
        topic: EVENTS.paymentReceived, eventType: EVENTS.paymentReceived,
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { paymentId: p.id, invoiceId: p.invoiceId, amountMinor: p.amountMinor, receiptNo },
      });
      if (updated.status === "paid") {
        await enqueue(tx, {
          topic: EVENTS.invoicePaid, eventType: EVENTS.invoicePaid,
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { invoiceId: p.invoiceId, totalMinor: updated.totalMinor.toString() },
        });
      }
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "billing", action: "payment_record", resourceType: "payment", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(p.tenantId, "invoices");
    await cache.invalidate(cache.makeKey(p.tenantId, "invoice", p.invoiceId));
  });
}
