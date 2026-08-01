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
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import { DomainError } from "../../shared/domain.js";
import * as repo from "./repo.js";
import {
  createItemPayload, updateItemPayload, createCategoryPayload, createUomPayload,
  createSubstitutePayload, createBinPayload, createReservationPayload,
  releaseReservationPayload, createGoodsReturnPayload, qcInspectionPayload,
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

  // ── Substitutes (SVC-051) ─────────────────────────────────────────────────
  queue.subscribe(COMMANDS.substituteCreate, async (msg) => {
    const p = createSubstitutePayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      try {
        await repo.insertSubstitute(tx, {
          id: p.id, tenantId: p.tenantId, itemId: p.itemId, substituteId: p.substituteId,
          priority: p.priority, conversionFactor: p.conversionFactor, createdBy: msg.actorId,
        });
      } catch (err) {
        // uq_item_subs_pair(tenant_id, item_id, substitute_id) — a concurrent
        // duplicate loses the race and hits Postgres 23505; translate to a
        // NonRetryableError so it dead-letters instead of retry-looping.
        if ((err as { code?: string }).code === "23505") {
          throw new NonRetryableError(`SUBSTITUTE_DUPLICATE: '${p.substituteId}' already a substitute for item ${p.itemId}`);
        }
        throw err;
      }
      await emit(tx, msg, EVENTS.substituteCreated, { itemId: p.itemId, substituteId: p.substituteId }, "create", "substitute", p.id);
    });
  });

  // ── Bins/Rack (SVC-052) ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.binCreate, async (msg) => {
    const p = createBinPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      try {
        await repo.insertBin(tx, {
          id: p.id, tenantId: p.tenantId, storeId: p.storeId, code: p.code,
          aisle: p.aisle ?? null, rack: p.rack ?? null, shelf: p.shelf ?? null,
          capacity: p.capacity ?? null, isActive: true,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      } catch (err) {
        // uq_bins_store_code(tenant_id, store_id, code)
        if ((err as { code?: string }).code === "23505") {
          throw new NonRetryableError(`BIN_DUPLICATE: code '${p.code}' already exists for store ${p.storeId}`);
        }
        throw err;
      }
      await emit(tx, msg, EVENTS.binCreated, { storeId: p.storeId, code: p.code }, "create", "bin", p.id);
    });
  });

  // ── Reservations (SVC-054) ─────────────────────────────────────────────────
  queue.subscribe(COMMANDS.reservationCreate, async (msg) => {
    const p = createReservationPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertReservation(tx, {
        id: p.id, tenantId: p.tenantId, itemId: p.itemId, storeId: p.storeId, qty: p.qty,
        refType: p.refType, refId: p.refId, status: "active",
        expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await emit(tx, msg, EVENTS.reservationCreated, { itemId: p.itemId, storeId: p.storeId, qty: p.qty }, "create", "reservation", p.id);
    });
  });

  queue.subscribe(COMMANDS.reservationRelease, async (msg) => {
    const p = releaseReservationPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // State transition on an existing row: load/validate/update inside repo.
      // NOT_FOUND, already-released and version-conflict all collapse into the
      // same guarded UPDATE...WHERE, which is safe under concurrency.
      try {
        await repo.releaseReservation(tx, p.id, p.tenantId, p.version, msg.actorId);
      } catch (err) {
        if (err instanceof DomainError) throw new NonRetryableError(err.message);
        throw err;
      }
      await emit(tx, msg, EVENTS.reservationReleased, { reservationId: p.id }, "release", "reservation", p.id);
    });
  });

  // ── Goods Returns + QC (SVC-053) ───────────────────────────────────────────
  queue.subscribe(COMMANDS.goodsReturnCreate, async (msg) => {
    const p = createGoodsReturnPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertGoodsReturn(tx, {
        id: p.id, tenantId: p.tenantId, originalIssueId: p.originalIssueId, itemId: p.itemId,
        storeId: p.storeId, qty: p.qty, reason: p.reason, qcStatus: "pending", disposition: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await emit(tx, msg, EVENTS.goodsReturnCreated, { itemId: p.itemId, storeId: p.storeId, qty: p.qty }, "create", "goods_return", p.id);
    });
  });

  queue.subscribe(COMMANDS.goodsReturnInspect, async (msg) => {
    const p = qcInspectionPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // State transition: only a 'pending' goods return may be inspected.
      // Loads current state implicitly via the guarded UPDATE...WHERE qc_status='pending'.
      const patch: { qcStatus: string; qcInspectedBy: string; qcInspectedAt: Date; qcNotes?: string; disposition: string } = {
        qcStatus: p.qcStatus, qcInspectedBy: p.inspectedBy, qcInspectedAt: new Date(), disposition: p.disposition,
      };
      if (p.qcNotes !== undefined) patch.qcNotes = p.qcNotes;
      try {
        await repo.updateGoodsReturnQc(tx, p.id, p.tenantId, patch);
      } catch (err) {
        if (err instanceof DomainError) throw new NonRetryableError(err.message);
        throw err;
      }
      await emit(tx, msg, EVENTS.goodsReturnInspected, { goodsReturnId: p.id, qcStatus: p.qcStatus, disposition: p.disposition }, "inspect", "goods_return", p.id);
    });
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
