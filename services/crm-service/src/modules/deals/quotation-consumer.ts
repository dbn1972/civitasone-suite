import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-quotation-consumer" });
const RESOURCE = "quotation";

type CtxLike = { tenantId: string; actorId: string; correlationId: string };

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): CtxLike {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

interface LineItemPayload {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: string;
  taxRateBps?: number;
}

/**
 * QP-003: persist a quotation'\''s line items relationally in crm.quotation_line_items.
 * line_total_minor is computed with BigInt (unit price paise * quantity) — no float.
 * Rows for the quotation are replaced wholesale so a re-applied write is idempotent.
 */
async function persistLineItems(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  quotationId: string,
  actorId: string,
  items: LineItemPayload[],
): Promise<void> {
  await tx.execute(sql`
    DELETE FROM crm.quotation_line_items WHERE tenant_id = ${tenantId} AND quotation_id = ${quotationId}
  `);
  let ordinal = 0;
  for (const item of items) {
    const lineTotal = (BigInt(item.unitPriceMinor) * BigInt(item.quantity)).toString();
    await tx.execute(sql`
      INSERT INTO crm.quotation_line_items
        (tenant_id, quotation_id, product_id, description, quantity, unit_price_minor, tax_rate_bps, line_total_minor, ordinal, created_by)
      VALUES (${tenantId}, ${quotationId}, ${item.productId ?? null}, ${item.description}, ${item.quantity},
              ${item.unitPriceMinor}::bigint, ${item.taxRateBps ?? 0}, ${lineTotal}::bigint, ${ordinal}, ${actorId})
    `);
    ordinal += 1;
  }
}

export function registerQuotationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createQuotation, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; dealId?: string | null; quoteRef: string; templateRef: string;
      totalMinor: string; currency: string; validUntil?: string | null; lineItems: LineItemPayload[];
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.quotations
            (id, tenant_id, deal_id, quote_ref, template_ref, version_number, status,
             total_minor, currency, valid_until, line_items, created_by, updated_by)
          VALUES (
            ${p.id}, ${p.tenantId}, ${p.dealId ?? null}, ${p.quoteRef},
            ${p.templateRef}, 1, 'draft', ${p.totalMinor}::bigint,
            ${p.currency}, ${p.validUntil ?? null}::timestamptz,
            ${JSON.stringify(p.lineItems)}::jsonb, ${msg.actorId}, ${msg.actorId}
          )
        `);
        await persistLineItems(tx, p.tenantId, p.id, msg.actorId, p.lineItems ?? []);
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.quotationCreated,
          action: "create",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: {
            quotationId: p.id, quoteRef: p.quoteRef, versionNumber: 1,
            totalMinor: p.totalMinor, currency: p.currency,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createQuotation failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.versionQuotation, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; sourceId: string; nextVersionNumber: number;
      totalMinor: string; validUntil?: string | null; lineItems: LineItemPayload[];
      quoteRef: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.quotations
            (id, tenant_id, deal_id, quote_ref, template_ref, version_number, status,
             total_minor, currency, valid_until, line_items, created_by, updated_by)
          SELECT ${p.id}, tenant_id, deal_id, quote_ref, template_ref, ${p.nextVersionNumber}, 'draft',
                 ${p.totalMinor}::bigint, currency,
                 COALESCE(${p.validUntil ?? null}::timestamptz, valid_until),
                 ${JSON.stringify(p.lineItems)}::jsonb, ${msg.actorId}, ${msg.actorId}
          FROM crm.quotations
          WHERE id = ${p.sourceId} AND tenant_id = ${p.tenantId}
        `);
        await persistLineItems(tx, p.tenantId, p.id, msg.actorId, p.lineItems ?? []);
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.quotationVersioned,
          action: "new_version",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: {
            quotationId: p.id, clonedFrom: p.sourceId, quoteRef: p.quoteRef,
            versionNumber: p.nextVersionNumber, totalMinor: p.totalMinor,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "versionQuotation failed");
      throw err;
    }
  });

  async function transition(
    msg: { messageId: string; tenantId: string; actorId: string; correlationId: string },
    p: {
      id: string; tenantId: string; expectedVersion: number; fromStatus: string; toStatus: string;
      rejectReason?: string; eventType: string; action: string; extraPayload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const extra =
        p.toStatus === "sent" ? sql`, sent_at = now()`
        : p.toStatus === "accepted" ? sql`, decided_at = now()`
        : p.toStatus === "rejected" ? sql`, decided_at = now(), reject_reason = ${p.rejectReason ?? ""}`
        : sql``;
      const updated = await tx.execute(sql`
        UPDATE crm.quotations
        SET status = ${p.toStatus}${extra},
            updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
        WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.expectedVersion}
        RETURNING id
      `) as unknown as Array<{ id: string }>;
      if (updated.length === 0) return;
      await emitWithAudit(tx, ctxOf(msg) as never, {
        eventType: p.eventType,
        action: p.action,
        resourceType: RESOURCE,
        resourceId: p.id,
        payload: {
          quotationId: p.id, fromStatus: p.fromStatus, toStatus: p.toStatus,
          ...(p.extraPayload ?? {}),
        },
      });
    });
  }

  queue.subscribe(COMMANDS.sendQuotation, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; expectedVersion: number; fromStatus: string;
    };
    try {
      await transition(msg, {
        ...p, toStatus: "sent", eventType: EVENTS.quotationSent, action: "send",
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "sendQuotation failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.acceptQuotation, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; expectedVersion: number; fromStatus: string;
      totalMinor: string; currency: string;
    };
    try {
      await transition(msg, {
        ...p, toStatus: "accepted", eventType: EVENTS.quotationAccepted, action: "accept",
        extraPayload: { totalMinor: p.totalMinor, currency: p.currency },
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "acceptQuotation failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.rejectQuotation, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; expectedVersion: number; fromStatus: string; reason: string;
    };
    try {
      await transition(msg, {
        ...p, toStatus: "rejected", rejectReason: p.reason,
        eventType: EVENTS.quotationRejected, action: "reject",
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "rejectQuotation failed");
      throw err;
    }
  });
}
