/**
 * Price-book consumer (QP-002) — applies book create/update/delete and item upsert/delete.
 * price_minor is bigint MINOR units carried as a decimal string.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-price-book-consumer" });
const RESOURCE = "price_book";

interface PriceBookEntryInput {
  productId: string;
  priceMinor: string;
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as Parameters<typeof emitWithAudit>[1];
}

/**
 * Upsert one price-book entry — the same statement `upsertPriceBookItem` below already
 * uses for the one-item-at-a-time endpoint, factored out so create/update-with-entries
 * can apply a whole array transactionally instead of looping HTTP calls (which, for a
 * brand-new book, would race the async book-create command: the row the item upsert
 * needs to find might not exist yet).
 */
async function upsertEntry(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  tenantId: string,
  priceBookId: string,
  entry: PriceBookEntryInput,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO crm.price_book_items (tenant_id, price_book_id, product_id, price_minor, created_by, updated_by)
    VALUES (${tenantId}, ${priceBookId}, ${entry.productId}, ${entry.priceMinor}::bigint, ${actorId}, ${actorId})
    ON CONFLICT (tenant_id, price_book_id, product_id) DO UPDATE
      SET price_minor = EXCLUDED.price_minor, updated_at = now(), updated_by = EXCLUDED.updated_by, version = crm.price_book_items.version + 1
  `);
}

export function registerPriceBookConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createPriceBook, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; segment?: string | null; currency: string;
      geography?: string | null; channel?: string | null; priority: number; enabled: boolean;
      entries?: PriceBookEntryInput[];
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.price_books (id, tenant_id, name, segment, currency, geography, channel, priority, enabled, created_by, updated_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${p.segment ?? null}, ${p.currency}, ${p.geography ?? null},
                  ${p.channel ?? null}, ${p.priority}, ${p.enabled}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (id) DO NOTHING
        `);
        // A brand-new book has no prior entries, so there's nothing to reconcile away —
        // just persist whatever the create payload carried, in the SAME transaction as
        // the book row itself (atomic: either both land, or neither does).
        for (const entry of p.entries ?? []) {
          await upsertEntry(tx, p.tenantId, p.id, entry, msg.actorId);
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.priceBookCreated, action: "create", resourceType: RESOURCE, resourceId: p.id,
          payload: { priceBookId: p.id, name: p.name, entryCount: p.entries?.length ?? 0 },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createPriceBook failed"); throw err; }
  });

  queue.subscribe(COMMANDS.updatePriceBook, async (msg) => {
    const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const sets: ReturnType<typeof sql>[] = [];
        if (p.name !== undefined) sets.push(sql`name = ${p.name as string}`);
        if (p.segment !== undefined) sets.push(sql`segment = ${p.segment as string | null}`);
        if (p.currency !== undefined) sets.push(sql`currency = ${p.currency as string}`);
        if (p.geography !== undefined) sets.push(sql`geography = ${p.geography as string | null}`);
        if (p.channel !== undefined) sets.push(sql`channel = ${p.channel as string | null}`);
        if (p.priority !== undefined) sets.push(sql`priority = ${p.priority as number}`);
        if (p.enabled !== undefined) sets.push(sql`enabled = ${p.enabled as boolean}`);
        // `entries`, when present, is the book's COMPLETE desired set of prices (see
        // routes.ts) — replace what's there rather than merge, so removing a row in the
        // editor and saving actually removes it here too. Absent (undefined) means the
        // caller isn't touching prices at all; existing entries are left alone, same as
        // every other field this consumer only sets `if (... !== undefined)`.
        const entries = p.entries as PriceBookEntryInput[] | undefined;
        if (sets.length === 0 && entries === undefined) return;
        if (sets.length > 0) {
          await tx.execute(sql`
            UPDATE crm.price_books SET ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
            WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
          `);
        }
        if (entries !== undefined) {
          await tx.execute(sql`DELETE FROM crm.price_book_items WHERE tenant_id = ${p.tenantId} AND price_book_id = ${p.id}`);
          for (const entry of entries) {
            await upsertEntry(tx, p.tenantId, p.id, entry, msg.actorId);
          }
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.priceBookUpdated, action: "update", resourceType: RESOURCE, resourceId: p.id,
          payload: { priceBookId: p.id, ...(entries !== undefined ? { entryCount: entries.length } : {}) },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "updatePriceBook failed"); throw err; }
  });

  queue.subscribe(COMMANDS.deletePriceBook, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`DELETE FROM crm.price_book_items WHERE price_book_id = ${p.id} AND tenant_id = ${p.tenantId}`);
        await tx.execute(sql`DELETE FROM crm.price_books WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.priceBookDeleted, action: "delete", resourceType: RESOURCE, resourceId: p.id,
          payload: { priceBookId: p.id },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "deletePriceBook failed"); throw err; }
  });

  queue.subscribe(COMMANDS.upsertPriceBookItem, async (msg) => {
    const p = msg.payload as { tenantId: string; priceBookId: string; productId: string; priceMinor: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await upsertEntry(tx, p.tenantId, p.priceBookId, { productId: p.productId, priceMinor: p.priceMinor }, msg.actorId);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.priceBookItemUpserted, action: "upsert", resourceType: "price_book_item",
          resourceId: `${p.priceBookId}:${p.productId}`,
          payload: { priceBookId: p.priceBookId, productId: p.productId },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "upsertPriceBookItem failed"); throw err; }
  });

  queue.subscribe(COMMANDS.deletePriceBookItem, async (msg) => {
    const p = msg.payload as { tenantId: string; priceBookId: string; productId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          DELETE FROM crm.price_book_items WHERE tenant_id = ${p.tenantId} AND price_book_id = ${p.priceBookId} AND product_id = ${p.productId}
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.priceBookItemDeleted, action: "delete", resourceType: "price_book_item",
          resourceId: `${p.priceBookId}:${p.productId}`,
          payload: { priceBookId: p.priceBookId, productId: p.productId },
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "deletePriceBookItem failed"); throw err; }
  });
}
