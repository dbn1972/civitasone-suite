/**
 * item-links consumer -- the ONLY code that writes the item cross-reference.
 *
 * Every handler validates the payload with zod, dedupes via markProcessed, and mutates inside
 * one transaction together with an `audit.event.record` transactional-outbox event.
 * "At most one link each way" is enforced by the two UNIQUE indexes (migration 0025), so two
 * concurrent link commands for the same item can never both commit.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import { DomainError } from "../../shared/domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import { createItemLinkPayload, removeItemLinkPayload } from "./validators.js";

type PgError = { code?: string; constraint?: string; constraint_name?: string };

export function registerItemLinkConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.itemLinkCreate, async (msg) => {
    const p = createItemLinkPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      try {
        await repo.insertLink(tx, {
          id: p.id, tenantId: p.tenantId, inventoryItemId: p.inventoryItemId, stockItemId: p.stockItemId,
          stockItemCode: p.stockItemCode, stockItemName: p.stockItemName, linkSource: p.source, linkedBy: msg.actorId,
        });
      } catch (err) {
        const e = err as PgError;
        // uq_item_stock_links_inventory / uq_item_stock_links_stock: a concurrent link of the
        // same inventory item or the same stock item lost the race. Not retryable.
        if (e.code === "23505") {
          throw new NonRetryableError(`ITEM_LINK_CONFLICT: inventory item ${p.inventoryItemId} or stock item ${p.stockItemId} is already linked`);
        }
        // FK to inventory.items: the inventory item vanished between the route check and here.
        if (e.code === "23503") {
          throw new NonRetryableError(`ITEM_LINK_INVENTORY_ITEM_MISSING: inventory item ${p.inventoryItemId} does not exist`);
        }
        throw err;
      }
      await emit(tx, msg, EVENTS.itemLinked, { inventoryItemId: p.inventoryItemId, stockItemId: p.stockItemId }, "link", p.id,
        { after: { inventoryItemId: p.inventoryItemId, stockItemId: p.stockItemId, stockItemCode: p.stockItemCode, source: p.source } });
    });
    await invalidate(msg.tenantId, p.inventoryItemId);
  });

  queue.subscribe(COMMANDS.itemLinkRemove, async (msg) => {
    const p = removeItemLinkPayload.parse(msg.payload);
    let inventoryItemId = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      let removed;
      try {
        removed = await repo.deleteLink(tx, p.id, p.tenantId);
      } catch (err) {
        if (err instanceof DomainError) throw new NonRetryableError(err.message);
        throw err;
      }
      inventoryItemId = removed.inventoryItemId;
      await emit(tx, msg, EVENTS.itemUnlinked, { inventoryItemId: removed.inventoryItemId, stockItemId: removed.stockItemId }, "unlink", p.id,
        { before: { inventoryItemId: removed.inventoryItemId, stockItemId: removed.stockItemId, stockItemCode: removed.stockItemCode } });
    });
    if (inventoryItemId) await invalidate(msg.tenantId, inventoryItemId);
  });
}

async function invalidate(tenantId: string, inventoryItemId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE.item, inventoryItemId));
  await cache.invalidateResource(tenantId, RESOURCE.item);
}

/** Domain event + audit event in the same tx (transactional outbox). */
async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
  auditDetail: Record<string, unknown>,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "inventory", action, resourceType: "item_stock_link", resourceId, outcome: "success", ...auditDetail },
  });
}
