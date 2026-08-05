/**
 * Gap 6 — Payment-Due / Balance Alert Event Consumer.
 *
 * Subscribes to:
 * - external.payment.due → creates a next_action ("payment_reminder")
 * - external.balance.alert → creates an activity log entry + triggers notification
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";

interface PaymentDuePayload {
  contactId: string;
  productId: string;
  dueDate: string;
  amountMinor: number;
}

interface BalanceAlertPayload {
  contactId: string;
  accountRef: string;
  balance: number;
  threshold: number;
}

const AUDIT_TOPIC = "audit.event.record";

export function registerPaymentConsumers(queue: Queue): void {
  // On payment due: create a next_action
  queue.subscribe<PaymentDuePayload>(CONSUMED_EVENTS.externalPaymentDue, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Insert a next-action record for "payment_reminder"
      await tx.execute(sql`
        INSERT INTO crm.next_actions (tenant_id, subject_type, subject_id, type, label, due_at, created_by)
        VALUES (${msg.tenantId}, 'contact', ${msg.payload.contactId}, 'payment_reminder',
                ${"Payment due: " + String(msg.payload.amountMinor) + " on " + msg.payload.dueDate},
                ${msg.payload.dueDate}::timestamptz, ${msg.actorId})
        ON CONFLICT DO NOTHING
      `);

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "create_payment_reminder", resourceType: "next_action", resourceId: msg.payload.contactId, outcome: "success" },
      });
    });
  });

  // On balance alert: create an activity log entry
  queue.subscribe<BalanceAlertPayload>(CONSUMED_EVENTS.externalBalanceAlert, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Insert an activity log entry
      await tx.execute(sql`
        INSERT INTO crm.activities (tenant_id, contact_id, type, subject, notes, status, created_by)
        VALUES (${msg.tenantId}, ${msg.payload.contactId}, 'alert',
                ${"Balance alert: " + msg.payload.accountRef},
                ${"Balance " + String(msg.payload.balance) + " below threshold " + String(msg.payload.threshold)},
                'completed', ${msg.actorId})
      `);

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "log_balance_alert", resourceType: "activity", resourceId: msg.payload.contactId, outcome: "success" },
      });
    });
  });
}
