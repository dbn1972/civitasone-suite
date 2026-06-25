/**
 * items consumer — the ONLY code that writes the item master to Postgres.
 *
 * Every handler:
 *   1. validates the PAYLOAD with zod (envelope is parsed by the bus),
 *   2. dedupes via markProcessed (idempotency),
 *   3. mutates inside a single transaction with a transactional-outbox event,
 *   4. invalidates the read cache after commit.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import {
  createItemPayload, updateItemPayload, createCategoryPayload, createUomPayload,
} from "./validators.js";

export function registerItemConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.itemCreate, async (msg) => {
    const p = createItemPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertItem(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, sku: p.sku ?? null,
        status: "active", categoryId: p.categoryId ?? null, uomId: p.uomId ?? null,
        itemType: p.itemType, reorderLevel: p.reorderLevel, reorderQty: p.reorderQty,
        valuationMethod: p.valuationMethod, unitCostMinor: BigInt(p.unitCostMinor),
        currency: p.currency, isActive: true, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await emit(tx, msg, EVENTS.itemCreated, { itemId: p.id, name: p.name }, "create", "item", p.id);
    });
    await invalidate(msg.tenantId, RESOURCE.item, p.id);
  });

  queue.subscribe(COMMANDS.itemUpdate, async (msg) => {
    const p = updateItemPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch: Record<string, unknown> = {};
      if (p.name !== undefined) patch.name = p.name;
      if (p.sku !== undefined) patch.sku = p.sku;
      if (p.status !== undefined) patch.status = p.status;
      if (p.categoryId !== undefined) patch.categoryId = p.categoryId;
      if (p.uomId !== undefined) patch.uomId = p.uomId;
      if (p.reorderLevel !== undefined) patch.reorderLevel = p.reorderLevel;
      if (p.reorderQty !== undefined) patch.reorderQty = p.reorderQty;
      if (p.valuationMethod !== undefined) patch.valuationMethod = p.valuationMethod;
      if (p.unitCostMinor !== undefined) patch.unitCostMinor = BigInt(p.unitCostMinor);
      // Optimistic lock: throws VERSION_CONFLICT / NOT_FOUND (handled by worker).
      const row = await repo.updateItemChecked(tx, p.id, p.tenantId, p.version, patch, msg.actorId);
      await emit(tx, msg, EVENTS.itemUpdated, { itemId: p.id, version: row.version }, "update", "item", p.id);
    });
    await invalidate(msg.tenantId, RESOURCE.item, p.id);
  });

  queue.subscribe(COMMANDS.categoryCreate, async (msg) => {
    const p = createCategoryPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCategory(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, code: p.code,
        parentId: p.parentId ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await emit(tx, msg, INTEGRATION.audit, {}, "create", "category", p.id, true);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.category);
  });

  queue.subscribe(COMMANDS.uomCreate, async (msg) => {
    const p = createUomPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertUom(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, symbol: p.symbol,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await emit(tx, msg, INTEGRATION.audit, {}, "create", "uom", p.id, true);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.uom);
  });
}

async function invalidate(tenantId: string, resource: string, id: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, resource, id));
  await cache.invalidateResource(tenantId, resource);
}

/**
 * Enqueue a domain event + an audit event in the same tx (transactional outbox).
 * Pass `auditOnly` to skip the domain event for low-traffic master data.
 */
async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceType: string,
  resourceId: string,
  auditOnly = false,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  if (!auditOnly) {
    await enqueue(t, {
      topic: eventType, eventType,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload,
    });
  }
  await enqueue(t, {
    topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "inventory", action, resourceType, resourceId, outcome: "success" },
  });
}
