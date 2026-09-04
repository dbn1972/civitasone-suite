import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
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
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Reserved inside this transaction (see repo.nextBillNumber) —
      // replaces the old `SEWB-${Date.now()}` scheme.
      const billNumber = `SEWB-${await repo.nextBillNumber(tx)}`;
      // p.amountMinor is a canonical minor-unit string (zMoneyMinorStringNonNeg
      // at the route boundary) — BigInt(string) rebuilds the exact integer
      // with no intermediate JS `number` in the path.
      const amountMinor = BigInt(p.amountMinor);
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, connectionId: p.connectionId,
        billNumber, billingPeriod: p.billingPeriod,
        amountMinor, dueDate: p.dueDate, status: "generated",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.billGenerated, eventType: EVENTS.billGenerated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { billId: p.id, billNumber, connectionId: p.connectionId },
      });
      // Fee becomes due the moment the bill is generated — billing/routes.ts
      // has already pre-accept-checked the connection exists and is active,
      // and rejected a duplicate bill for the same connection+period, so
      // this consumer only needs to guard against re-delivery (markProcessed
      // above) and a nonpositive amount (emitMunicipalFeeChallan no-ops for
      // that, and enforces its own bounds ceiling). No name/citizen field
      // exists anywhere on the bill/connection/application chain in this
      // service (see shared/cross-events.ts's file header), so billNumber —
      // reserved a moment ago in this same transaction — is the best
      // available depositor/recipient reference, the same fallback
      // parking-service used for booking.vehicleNumber.
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: billNumber,
        depositor: billNumber,
        amountMinor,
      });
      // Citizen-meaningful: a bill was just raised against the citizen's
      // connection and a fee is now due.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.feeDue,
        recipient: billNumber,
        recipientId: p.id,
        variables: { billId: p.id, billNumber, connectionId: p.connectionId, amountMinor: p.amountMinor },
      });
      await writeAudit(tx, ctxOf(msg), { action: "bill.generate", resourceType: "sewerage_bill", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "bill generated");
  });

  queue.subscribe(COMMANDS.billPay, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction — the
    // billNumber isn't in this command's payload ({id, paymentRef,
    // version}), so it must be fetched here rather than inside the
    // transaction below. repo.findById opens its own scopedRead
    // transaction; nesting it inside db.transaction would deadlock the
    // connection pool under concurrent load exactly like PR #1028's
    // checkQuota/checkDlt bug in notification-service.
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: payment confirmation.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.billNumber,
          recipientId: p.id,
          variables: { billId: p.id, billNumber: existing.billNumber, status: "paid", paymentRef: p.paymentRef },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "bill.pay", resourceType: "sewerage_bill", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "bill paid");
  });
}
