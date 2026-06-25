/**
 * movements consumer — the ONLY code that writes the stock model to Postgres.
 *
 * Posting rules (all valued in paise, weighted-average costing):
 *   receipt    : inbound to a store, recomputes the moving average cost
 *   issue      : outbound from a store, guarded against going negative
 *   transfer   : outbound from one store + inbound to another (carries cost)
 *   adjustment : sets on-hand to a counted figure with a reason code
 *
 * Every handler is idempotent (markProcessed), validates its payload with zod,
 * mutates inside one transaction, writes an append-only ledger row per change,
 * emits a domain event + audit event via the transactional outbox, and emits
 * `inventory.stock.low` whenever an outbound movement breaches a reorder level.
 */
import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED, INTEGRATION, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { Tx } from "./repo.js";
import {
  receiptPayload, issuePayload, transferPayload, adjustmentPayload, grnAcceptedPayload,
} from "./validators.js";
import {
  weightedAvgRate, assertSufficientStock, valuationMinor, isLowStock, suggestedReorderQty,
} from "./domain.js";

type EnqueueTx = Parameters<typeof enqueue>[0];

export function registerMovementConsumers(queue: Queue): void {
  // ── Receipt (GRN-in) ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.receiptCreate, async (msg) => {
    const p = receiptPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await insertHeader(tx, msg, p.id, "receipt", { postingDate: p.postingDate, toStoreId: p.toStoreId, refDoc: p.refDoc, refNo: p.refNo, notes: p.notes });
      await insertLines(tx, msg, p.id, p.lines);

      let totalMinor = 0n;
      for (const line of p.lines) {
        const cur = await repo.lockBalance(tx, p.tenantId, line.itemId, p.toStoreId);
        const newRate = weightedAvgRate(cur, line.qty, BigInt(line.rateMinor));
        const newQty = cur.qty + line.qty;
        await repo.upsertBalance(tx, p.tenantId, line.itemId, p.toStoreId, newQty, newRate, line.currency);
        await ledger(tx, msg, p.id, "receipt", line.itemId, p.toStoreId, line.qty, 0, newQty, newRate, p.postingDate, null);
        totalMinor += valuationMinor(line.qty, BigInt(line.rateMinor));
      }
      await emitDomain(tx, msg, EVENTS.receiptPosted, { movementId: p.id, toStoreId: p.toStoreId, lines: p.lines.length });
      await emitGl(tx, msg, p.id, "receipt", totalMinor);
      await audit(tx, msg, "create", "receipt", p.id);
    });
    await invalidate(msg.tenantId);
  });

  // ── Issue / consumption ───────────────────────────────────────────────────
  queue.subscribe(COMMANDS.issueCreate, async (msg) => {
    const p = issuePayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await insertHeader(tx, msg, p.id, "issue", { postingDate: p.postingDate, fromStoreId: p.fromStoreId, refDoc: p.refDoc, refNo: p.refNo, reasonCode: p.reasonCode, notes: p.notes });
      await insertLines(tx, msg, p.id, p.lines);

      const low: LowStockHit[] = [];
      let totalMinor = 0n;
      for (const line of p.lines) {
        const cur = await repo.lockBalance(tx, p.tenantId, line.itemId, p.fromStoreId);
        assertSufficientStock(cur.qty, line.qty);
        const newQty = cur.qty - line.qty;
        await repo.upsertBalance(tx, p.tenantId, line.itemId, p.fromStoreId, newQty, cur.rateMinor, line.currency);
        await ledger(tx, msg, p.id, "issue", line.itemId, p.fromStoreId, 0, line.qty, newQty, cur.rateMinor, p.postingDate, p.reasonCode ?? null);
        totalMinor += valuationMinor(line.qty, cur.rateMinor);
        await collectLowStock(tx, p.tenantId, line.itemId, p.fromStoreId, newQty, low);
      }
      await emitDomain(tx, msg, EVENTS.issuePosted, { movementId: p.id, fromStoreId: p.fromStoreId, lines: p.lines.length });
      await emitGl(tx, msg, p.id, "issue", totalMinor);
      await audit(tx, msg, "create", "issue", p.id);
      await emitLowStock(tx, msg, low);
    });
    await invalidate(msg.tenantId);
  });

  // ── Inter-store transfer ───────────────────────────────────────────────────
  queue.subscribe(COMMANDS.transferCreate, async (msg) => {
    const p = transferPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await insertHeader(tx, msg, p.id, "transfer", { postingDate: p.postingDate, fromStoreId: p.fromStoreId, toStoreId: p.toStoreId, refNo: p.refNo, notes: p.notes });
      await insertLines(tx, msg, p.id, p.lines);

      const low: LowStockHit[] = [];
      for (const line of p.lines) {
        const src = await repo.lockBalance(tx, p.tenantId, line.itemId, p.fromStoreId);
        assertSufficientStock(src.qty, line.qty);
        const newSrcQty = src.qty - line.qty;
        await repo.upsertBalance(tx, p.tenantId, line.itemId, p.fromStoreId, newSrcQty, src.rateMinor, line.currency);
        await ledger(tx, msg, p.id, "transfer", line.itemId, p.fromStoreId, 0, line.qty, newSrcQty, src.rateMinor, p.postingDate, null);

        // Carry the source cost into the destination's moving average.
        const dst = await repo.lockBalance(tx, p.tenantId, line.itemId, p.toStoreId);
        const newDstRate = weightedAvgRate(dst, line.qty, src.rateMinor);
        const newDstQty = dst.qty + line.qty;
        await repo.upsertBalance(tx, p.tenantId, line.itemId, p.toStoreId, newDstQty, newDstRate, line.currency);
        await ledger(tx, msg, p.id, "transfer", line.itemId, p.toStoreId, line.qty, 0, newDstQty, newDstRate, p.postingDate, null);

        await collectLowStock(tx, p.tenantId, line.itemId, p.fromStoreId, newSrcQty, low);
      }
      await emitDomain(tx, msg, EVENTS.transferPosted, { movementId: p.id, fromStoreId: p.fromStoreId, toStoreId: p.toStoreId, lines: p.lines.length });
      await audit(tx, msg, "create", "transfer", p.id);
      await emitLowStock(tx, msg, low);
    });
    await invalidate(msg.tenantId);
  });

  // ── Stock-take adjustment ─────────────────────────────────────────────────
  queue.subscribe(COMMANDS.adjustmentCreate, async (msg) => {
    const p = adjustmentPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await insertHeader(tx, msg, p.id, "adjustment", { postingDate: p.postingDate, toStoreId: p.storeId, reasonCode: p.reasonCode, notes: p.notes });
      await repo.insertMovementLines(tx, p.lines.map((l) => ({
        id: randomUUID(), tenantId: p.tenantId, movementId: p.id, itemId: l.itemId,
        qty: l.countedQty, rateMinor: 0n, amountMinor: 0n, currency: "INR",
      })));

      const low: LowStockHit[] = [];
      for (const line of p.lines) {
        const cur = await repo.lockBalance(tx, p.tenantId, line.itemId, p.storeId);
        const diff = line.countedQty - cur.qty;
        await repo.upsertBalance(tx, p.tenantId, line.itemId, p.storeId, line.countedQty, cur.rateMinor, "INR");
        if (diff !== 0) {
          await ledger(tx, msg, p.id, "adjustment", line.itemId, p.storeId,
            Math.max(0, diff), Math.max(0, -diff), line.countedQty, cur.rateMinor, p.postingDate, p.reasonCode);
        }
        await collectLowStock(tx, p.tenantId, line.itemId, p.storeId, line.countedQty, low);
      }
      await emitDomain(tx, msg, EVENTS.adjustmentPosted, { movementId: p.id, storeId: p.storeId, reasonCode: p.reasonCode, lines: p.lines.length });
      await audit(tx, msg, "create", "adjustment", p.id);
      await emitLowStock(tx, msg, low);
    });
    await invalidate(msg.tenantId);
  });

  // ── procurement GRN accepted → auto receipt for consumable items ──────────
  queue.subscribe(CONSUMED.grnAccepted, async (msg) => {
    const p = grnAcceptedPayload.parse(msg.payload);
    const storeId = p.toStoreId ?? p.storeId;
    const stockItems = p.items.filter((i) => i.itemType !== "fixed_asset");
    if (!storeId || stockItems.length === 0) return;
    const postingDate = p.postingDate ?? new Date().toISOString().slice(0, 10);
    const movementId = randomUUID();

    await db.transaction(async (tx) => {
      // Stable dedupe key for the whole GRN.
      if (!(await markProcessed(tx, `${msg.messageId}:grn:${p.grnId}`))) return;
      await insertHeader(tx, msg, movementId, "receipt", { postingDate, toStoreId: storeId, refDoc: "GRN", refNo: p.grnId });
      await insertLines(tx, msg, movementId, stockItems.map((i) => ({ itemId: i.itemId, qty: i.acceptedQty, rateMinor: i.rateMinor, currency: i.currency })));

      let totalMinor = 0n;
      for (const item of stockItems) {
        const cur = await repo.lockBalance(tx, msg.tenantId, item.itemId, storeId);
        const newRate = weightedAvgRate(cur, item.acceptedQty, BigInt(item.rateMinor));
        const newQty = cur.qty + item.acceptedQty;
        await repo.upsertBalance(tx, msg.tenantId, item.itemId, storeId, newQty, newRate, item.currency);
        await ledger(tx, msg, movementId, "receipt", item.itemId, storeId, item.acceptedQty, 0, newQty, newRate, postingDate, null);
        totalMinor += valuationMinor(item.acceptedQty, BigInt(item.rateMinor));
      }
      await emitDomain(tx, msg, EVENTS.receiptPosted, { movementId, toStoreId: storeId, source: "grn", grnId: p.grnId });
      await emitGl(tx, msg, movementId, "receipt", totalMinor);
      await audit(tx, msg, "create", "receipt", movementId);
    });
    await invalidate(msg.tenantId);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────

interface LowStockHit { itemId: string; storeId: string; onHandQty: number; reorderLevel: number; reorderQty: number }

interface HeaderFields {
  postingDate: string;
  fromStoreId?: string | undefined; toStoreId?: string | undefined;
  refDoc?: string | undefined; refNo?: string | undefined; reasonCode?: string | undefined; notes?: string | undefined;
}

async function insertHeader(tx: Tx, msg: CommandEnvelope, id: string, movementType: string, f: HeaderFields): Promise<void> {
  await repo.insertMovement(tx, {
    id, tenantId: msg.tenantId, movementType,
    refDoc: f.refDoc ?? null, refNo: f.refNo ?? null,
    postingDate: f.postingDate,
    fromStoreId: f.fromStoreId ?? null, toStoreId: f.toStoreId ?? null,
    reasonCode: f.reasonCode ?? null, notes: f.notes ?? null,
    status: "posted", createdBy: msg.actorId, updatedBy: msg.actorId,
  });
}

async function insertLines(
  tx: Tx, msg: CommandEnvelope, movementId: string,
  lines: Array<{ itemId: string; qty: number; rateMinor: number; currency: string }>,
): Promise<void> {
  await repo.insertMovementLines(tx, lines.map((l) => ({
    id: randomUUID(), tenantId: msg.tenantId, movementId, itemId: l.itemId,
    qty: l.qty, rateMinor: BigInt(l.rateMinor), amountMinor: BigInt(l.qty) * BigInt(l.rateMinor),
    currency: l.currency,
  })));
}

async function ledger(
  tx: Tx, msg: CommandEnvelope, movementId: string, movementType: string,
  itemId: string, storeId: string, qtyIn: number, qtyOut: number, balanceQty: number,
  rateMinor: bigint, postingDate: string, reasonCode: string | null,
): Promise<void> {
  await repo.appendLedger(tx, {
    id: randomUUID(), tenantId: msg.tenantId, itemId, storeId, movementId, movementType,
    qtyIn, qtyOut, balanceQty, rateMinor,
    valueMinor: BigInt(balanceQty) * rateMinor,
    currency: "INR", reasonCode, postingDate, createdBy: msg.actorId,
  });
}

async function collectLowStock(tx: Tx, tenantId: string, itemId: string, storeId: string, onHandQty: number, sink: LowStockHit[]): Promise<void> {
  const policy = await repo.getReorderPolicy(tx, tenantId, itemId);
  if (policy && isLowStock(onHandQty, policy.reorderLevel)) {
    sink.push({ itemId, storeId, onHandQty, reorderLevel: policy.reorderLevel, reorderQty: policy.reorderQty });
  }
}

async function emitLowStock(tx: Tx, msg: CommandEnvelope, hits: LowStockHit[]): Promise<void> {
  for (const h of hits) {
    await enqueue(tx as EnqueueTx, {
      topic: EVENTS.stockLow, eventType: EVENTS.stockLow,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: {
        itemId: h.itemId, storeId: h.storeId, onHandQty: h.onHandQty,
        reorderLevel: h.reorderLevel,
        suggestedReorderQty: suggestedReorderQty(h.onHandQty, h.reorderLevel, h.reorderQty),
      },
    });
  }
}

async function emitDomain(tx: Tx, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await enqueue(tx as EnqueueTx, {
    topic: eventType, eventType,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload,
  });
}

async function emitGl(tx: Tx, msg: CommandEnvelope, movementId: string, kind: string, totalMinor: bigint): Promise<void> {
  await enqueue(tx as EnqueueTx, {
    topic: INTEGRATION.glPost, eventType: INTEGRATION.glPost,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { movementId, kind, totalMinor: totalMinor.toString(), type: "inventory_movement" },
  });
}

async function audit(tx: Tx, msg: CommandEnvelope, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx as EnqueueTx, {
    topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "inventory", action, resourceType, resourceId, outcome: "success" },
  });
}

async function invalidate(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RESOURCE.balance);
  await cache.invalidateResource(tenantId, RESOURCE.ledger);
  await cache.invalidateResource(tenantId, RESOURCE.lowStock);
}
