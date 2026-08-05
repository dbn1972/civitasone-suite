/**
 * Product catalogue consumer (QP-001) — applies create/update/delete of crm.products.
 * price_minor is bigint MINOR units; carried as a decimal string and cast ::bigint here.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-product-consumer" });
const RESOURCE = "product";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as Parameters<typeof emitWithAudit>[1];
}

export function registerProductConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createProduct, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; category?: string; code: string; name: string; unit: string;
      taxRateBps: number; priceMinor: string; currency: string; activeFrom?: string | null; activeTo?: string | null; enabled: boolean;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.products
            (id, tenant_id, category, code, name, unit, tax_rate_bps, price_minor, currency, active_from, active_to, enabled, created_by, updated_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.category ?? null}, ${p.code}, ${p.name}, ${p.unit},
                  ${p.taxRateBps}, ${p.priceMinor}::bigint, ${p.currency}, ${p.activeFrom ?? null}::date,
                  ${p.activeTo ?? null}::date, ${p.enabled}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (tenant_id, code) DO NOTHING
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.productCreated, action: "create", resourceType: RESOURCE, resourceId: p.id,
          payload: { productId: p.id, code: p.code },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createProduct failed"); throw err; }
  });

  queue.subscribe(COMMANDS.updateProduct, async (msg) => {
    const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const sets: ReturnType<typeof sql>[] = [];
        if (p.category !== undefined) sets.push(sql`category = ${p.category as string | null}`);
        if (p.name !== undefined) sets.push(sql`name = ${p.name as string}`);
        if (p.unit !== undefined) sets.push(sql`unit = ${p.unit as string}`);
        if (p.taxRateBps !== undefined) sets.push(sql`tax_rate_bps = ${p.taxRateBps as number}`);
        if (p.priceMinor !== undefined) sets.push(sql`price_minor = ${p.priceMinor as string}::bigint`);
        if (p.currency !== undefined) sets.push(sql`currency = ${p.currency as string}`);
        if (p.activeFrom !== undefined) sets.push(sql`active_from = ${p.activeFrom as string | null}::date`);
        if (p.activeTo !== undefined) sets.push(sql`active_to = ${p.activeTo as string | null}::date`);
        if (p.enabled !== undefined) sets.push(sql`enabled = ${p.enabled as boolean}`);
        if (sets.length === 0) return;
        await tx.execute(sql`
          UPDATE crm.products SET ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.productUpdated, action: "update", resourceType: RESOURCE, resourceId: p.id,
          payload: { productId: p.id },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "updateProduct failed"); throw err; }
  });

  queue.subscribe(COMMANDS.deleteProduct, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Soft-disable rather than hard-delete: a product may be referenced by historical
        // quotation line items, so we retire it (enabled=false) to keep it unselectable
        // while preserving referential history.
        await tx.execute(sql`
          UPDATE crm.products SET enabled = false, updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.productDeleted, action: "delete", resourceType: RESOURCE, resourceId: p.id,
          payload: { productId: p.id },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "deleteProduct failed"); throw err; }
  });
}
