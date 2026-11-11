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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);

/**
 * crm.communications.id and .delivery_id are uuid columns. Other producers stamp non-uuid correlation
 * ids on notification.* events (document-service bulk-scan uses "bulk-scan-dispatch"); binding one
 * against a uuid column throws "invalid input syntax for type uuid" and the event is DLQ'd forever.
 * Only uuid-shaped candidates are matched; an event with none is not a CRM communication - ignore it.
 */
function matchClause(deliveryId: string | null, correlationId: string | null) {
  const d = asUuid(deliveryId);
  const c = asUuid(correlationId);
  if (d && c) return sql`(delivery_id = ${d} OR id = ${c})`;
  if (d) return sql`delivery_id = ${d}`;
  if (c) return sql`id = ${c}`;
  return null;
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
        const match = matchClause(deliveryId, msg.correlationId ?? null);
        if (!match) return;
        await tx.execute(sql`
          UPDATE crm.communications
          SET status = 'delivered'
          WHERE ${match}
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

        const match = matchClause(deliveryId, msg.correlationId ?? null);
        if (!match) return;
        await tx.execute(sql`
          UPDATE crm.communications
          SET status = 'failed'
          WHERE ${match}
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
