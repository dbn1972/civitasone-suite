/**
 * CO-001 — Delivery status feedback consumer.
 *
 * Subscribes to notification.delivered and notification.failed events.
 * When a delivery status event arrives with a correlationId matching a
 * crm communication record, updates status to delivered/failed.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";

const log = pino({ name: "crm-delivery-status-consumer" });

interface DeliveryStatusPayload {
  deliveryId?: string;
  id?: string;
  tenantId?: string;
  status?: string;
  correlationId?: string;
}

function extractDeliveryId(p: DeliveryStatusPayload): string | null {
  return p.deliveryId ?? p.id ?? null;
}

export function registerDeliveryStatusConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.notificationDelivered, async (msg) => {
    const p = msg.payload as DeliveryStatusPayload;
    const deliveryId = extractDeliveryId(p);
    if (!deliveryId) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Update matching communication record by delivery_id or correlation_id
        const result = await tx.execute(sql`
          UPDATE crm.communications
          SET status = 'delivered'
          WHERE (delivery_id = ${deliveryId} OR id = ${msg.correlationId})
            AND status IN ('pending', 'sent')
        `);
        log.info({ deliveryId, correlationId: msg.correlationId }, "delivery status updated to delivered");
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "delivery status update (delivered) failed");
      throw err;
    }
  });

  queue.subscribe(CONSUMED_EVENTS.notificationFailed, async (msg) => {
    const p = msg.payload as DeliveryStatusPayload;
    const deliveryId = extractDeliveryId(p);
    if (!deliveryId) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        await tx.execute(sql`
          UPDATE crm.communications
          SET status = 'failed'
          WHERE (delivery_id = ${deliveryId} OR id = ${msg.correlationId})
            AND status IN ('pending', 'sent')
        `);
        log.info({ deliveryId, correlationId: msg.correlationId }, "delivery status updated to failed");
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "delivery status update (failed) failed");
      throw err;
    }
  });
}
