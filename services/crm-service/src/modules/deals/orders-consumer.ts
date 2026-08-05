/**
 * Order consumer (QP-005) — applies crm.quotation.convert_to_order by creating a
 * crm.orders row from an accepted quotation. Idempotent on (tenant, quotation_id): a
 * re-fired convert leaves the first order intact. total_minor is bigint MINOR units.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-order-consumer" });
const RESOURCE = "order";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as Parameters<typeof emitWithAudit>[1];
}

export function registerOrderConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.convertQuotationToOrder, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; quotationId: string; quotationVersion: number;
      dealId: string | null; orderRef: string; totalMinor: string; currency: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Re-verify the quotation is accepted at apply time so a race (reject between the
        // route check and here) cannot mint an order for a non-accepted quote.
        const accepted = (await tx.execute(sql`
          SELECT 1 AS ok FROM crm.quotations
          WHERE id = ${p.quotationId} AND tenant_id = ${p.tenantId} AND status = 'accepted'
        `)) as unknown as Array<{ ok: number }>;
        if (accepted.length === 0) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.orderCreated, action: "convert_to_order", resourceType: RESOURCE, resourceId: p.id,
            payload: { quotationId: p.quotationId, rejected: true }, outcome: "rejected_quotation_not_accepted",
          });
          return;
        }
        const rows = (await tx.execute(sql`
          INSERT INTO crm.orders
            (id, tenant_id, quotation_id, quotation_version, deal_id, order_ref, total_minor, currency, created_by, updated_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.quotationId}, ${p.quotationVersion}, ${p.dealId},
                  ${p.orderRef}, ${p.totalMinor}::bigint, ${p.currency}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (tenant_id, quotation_id) DO NOTHING
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return; // already converted — idempotent no-op
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.orderCreated, action: "convert_to_order", resourceType: RESOURCE, resourceId: p.id,
          payload: { orderId: p.id, quotationId: p.quotationId, orderRef: p.orderRef, totalMinor: p.totalMinor, currency: p.currency },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "convertQuotationToOrder failed");
      throw err;
    }
  });
}
