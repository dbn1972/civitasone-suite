import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as invoiceRepo from "../invoices/repo.js";
import * as subsRepo from "../subscriptions/repo.js";
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
        amountMinor: amount, method: p.method ?? "gateway", status: "received",
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

  // ── billing.checkout.verify ──────────────────────────────────────────────
  // After Razorpay Checkout.js returns a valid signature, record the payment
  // and provision (activate) the subscription.
  queue.subscribe<{
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }>(COMMANDS.checkoutVerify, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Record the gateway transaction
      const paymentId = randomUUID();
      await repo.insertGatewayTxn(tx, {
        id: paymentId,
        tenantId: msg.tenantId,
        paymentId,
        gateway: "razorpay",
        gatewayRef: p.razorpayPaymentId,
        status: "captured",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Activate the tenant's subscription (mark as active)
      const sub = await subsRepo.findByTenant(msg.tenantId);
      if (sub) {
        await subsRepo.updateStatus(tx, sub.id, "active", msg.actorId);
      }

      await enqueue(tx, {
        topic: EVENTS.checkoutCompleted,
        eventType: EVENTS.checkoutCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: p.razorpayPaymentId },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "billing", action: "checkout_verify", resourceType: "payment", resourceId: paymentId, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, "subscriptions");
  });

  // ── billing.webhook.razorpay ─────────────────────────────────────────────
  // Razorpay server-to-server webhook (payment.captured, payment.failed, etc.)
  queue.subscribe<Record<string, unknown>>(COMMANDS.webhookRazorpay, async (msg) => {
    const payload = msg.payload;
    const event = (payload["event"] as string) ?? "";
    const entity = ((payload["payload"] as Record<string, unknown>)?.["payment"] as Record<string, unknown>)?.["entity"] as Record<string, unknown> | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (event === "payment.captured" && entity) {
        const orderId = entity["order_id"] as string ?? "";
        const paymentId = entity["id"] as string ?? "";
        const amountPaise = Number(entity["amount"] ?? 0);
        const tenantId = ((entity["notes"] as Record<string, unknown>)?.["tenantId"] as string) ?? msg.tenantId;

        const gwId = randomUUID();
        await repo.insertGatewayTxn(tx, {
          id: gwId, tenantId, paymentId: gwId, gateway: "razorpay",
          gatewayRef: paymentId,
          status: "captured", createdBy: "system", updatedBy: "system",
        });

        // Activate subscription on successful capture
        const sub = await subsRepo.findByTenant(tenantId);
        if (sub && sub.status !== "active") {
          await subsRepo.updateStatus(tx, sub.id, "active", "system");
        }

        await enqueue(tx, {
          topic: EVENTS.checkoutCompleted, eventType: EVENTS.checkoutCompleted,
          tenantId, actorId: "system", correlationId: msg.correlationId,
          payload: { razorpayOrderId: orderId, razorpayPaymentId: paymentId, amountPaise },
        });
      } else if (event === "payment.failed" && entity) {
        await enqueue(tx, {
          topic: EVENTS.checkoutFailed, eventType: EVENTS.checkoutFailed,
          tenantId: msg.tenantId, actorId: "system", correlationId: msg.correlationId,
          payload: { event, reason: (entity["error_description"] as string) ?? "payment failed" },
        });
      }

      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: "system", correlationId: msg.correlationId,
        payload: { service: "billing", action: "webhook_razorpay", resourceType: "webhook", resourceId: msg.messageId, outcome: "success", event },
      });
    });
  });

  // ── billing.dunning.retry ────────────────────────────────────────────────
  // Re-attempt a failed payment charge via the gateway.
  queue.subscribe<{ invoiceId: string; tenantId: string; attempt: number }>(COMMANDS.dunningRetry, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const inv = await invoiceRepo.findByIdTx(tx, p.invoiceId);
      if (!inv || inv.tenantId !== p.tenantId) return;
      if (inv.status === "paid") return; // already settled

      // In production, this would call razorpay.retryCharge() or create a new
      // payment link. For now, record the retry attempt and emit an event so
      // the dunning scheduler knows the attempt happened.
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: p.tenantId, actorId: "system", correlationId: msg.correlationId,
        payload: { service: "billing", action: "dunning_retry", resourceType: "invoice", resourceId: p.invoiceId, outcome: "attempted", attempt: p.attempt },
      });

      // If max retries exhausted, emit dunning.exhausted
      if (p.attempt >= 3) {
        await enqueue(tx, {
          topic: EVENTS.dunningExhausted, eventType: EVENTS.dunningExhausted,
          tenantId: p.tenantId, actorId: "system", correlationId: msg.correlationId,
          payload: { invoiceId: p.invoiceId, attempts: p.attempt },
        });
      }
    });
  });
}
