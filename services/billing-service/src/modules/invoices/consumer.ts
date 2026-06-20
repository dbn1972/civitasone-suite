import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { shouldSkipInvoiceGeneration } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const NOTIFICATION_TOPIC = "notification.alert.send";

export function registerInvoicesConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; periodMonth: string; govtExempt: boolean; totalMinor: number }>(
    COMMANDS.invoiceGenerate,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        if (shouldSkipInvoiceGeneration(msg.payload.govtExempt)) {
          await enqueue(tx, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.payload.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { service: "billing", action: "invoice_skipped_govt_exempt", resourceType: "invoice", resourceId: msg.payload.id, outcome: "skipped" },
          });
          return;
        }

        const total = BigInt(msg.payload.totalMinor);
        await repo.insertInvoice(tx, {
          id: msg.payload.id, tenantId: msg.payload.tenantId, periodMonth: msg.payload.periodMonth,
          status: "draft", totalMinor: total, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await repo.insertItem(tx, {
          tenantId: msg.payload.tenantId, invoiceId: msg.payload.id,
          description: `Usage for ${msg.payload.periodMonth}`, amountMinor: total,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "invoice_generate", msg.payload.id);
      });
      await cache.invalidate(cache.makeKey(msg.payload.tenantId, "invoices", msg.payload.tenantId));
    }
  );

  queue.subscribe<{ id: string }>(COMMANDS.invoiceIssue, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateInvoice(tx, msg.payload.id, { status: "issued", issuedAt: new Date(), updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.invoiceIssued, eventType: EVENTS.invoiceIssued,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { invoiceId: msg.payload.id },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_TOPIC, eventType: NOTIFICATION_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { alert: "invoice_issued", invoiceId: msg.payload.id },
      });
      await audit(tx, msg, "invoice_issue", msg.payload.id);
    });
  });

  queue.subscribe<{ id: string }>(COMMANDS.invoicePay, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateInvoice(tx, msg.payload.id, { status: "paid", paidAt: new Date(), updatedBy: msg.actorId });
      await audit(tx, msg, "invoice_pay", msg.payload.id);
    });
  });
}

async function audit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  const t = tx as any;
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "billing", action, resourceType: "invoice", resourceId, outcome: "success" },
  });
}
