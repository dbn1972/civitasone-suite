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
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, stableUuid } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED, INTEGRATION, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { Tx } from "./repo.js";
import {
  receiptPayload, issuePayload, transferPayload, adjustmentPayload, grnAcceptedPayload,
} from "./validators.js";
import {
  weightedAvgRate, assertSufficientStock, valuationMinor, isLowStock, suggestedReorderQty,
} from "./domain.js";
import { recomputeWavg } from "../costing/wavg-engine.js";
import { consumeFifo } from "../costing/fifo-engine.js";
import { DomainError } from "../../shared/domain.js";
import { fetchGrnReference } from "../srn/grn-client.js";

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
        const { newQty, newRate } = await postReceiptLine(
          tx, p.tenantId, msg.actorId, line.itemId, p.toStoreId,
          line.qty, BigInt(line.rateMinor), line.currency, p.postingDate, p.id,
        );
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
        const { newQty, newRate, costOfIssuePaise } = await postIssueLine(
          tx, p.tenantId, msg.actorId, line.itemId, p.fromStoreId, line.qty, line.currency,
        );
        await ledger(tx, msg, p.id, "issue", line.itemId, p.fromStoreId, 0, line.qty, newQty, newRate, p.postingDate, p.reasonCode ?? null);
        totalMinor += costOfIssuePaise;
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
        // Same deterministic-rejection reasoning as issueCreate above.
        try {
          assertSufficientStock(src.qty, line.qty);
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }
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
    // Best-effort: copy the GRN number / PO / supplier so the receipts register can show them.
    // Outside the transaction (no network call while holding row locks); null on any failure.
    const ref = await fetchGrnReference(msg.tenantId, p.grnId);

    await db.transaction(async (tx) => {
      // Stable dedupe key for the whole GRN. _inbox.processed.message_id is a uuid column, so the
      // composite key is folded into a deterministic uuid (the raw "<id>:grn:<id>" string made every
      // GRN-accepted receipt fail with "invalid input syntax for type uuid" and dead-letter).
      if (!(await markProcessed(tx, stableUuid(`${msg.messageId}:grn:${p.grnId}`)))) return;
      await insertHeader(tx, msg, movementId, "receipt", {
        postingDate, toStoreId: storeId, refDoc: "GRN", refNo: p.grnId,
        grnNo: ref?.grnNo, poRef: ref?.poRef, supplierId: ref?.supplierId,
      });
      await insertLines(tx, msg, movementId, stockItems.map((i) => ({ itemId: i.itemId, qty: i.acceptedQty, rateMinor: i.rateMinor, currency: i.currency })));

      let totalMinor = 0n;
      for (const item of stockItems) {
        const { newQty, newRate } = await postReceiptLine(
          tx, msg.tenantId, msg.actorId, item.itemId, storeId,
          item.acceptedQty, BigInt(item.rateMinor), item.currency, postingDate, movementId,
        );
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

/**
 * Post a single receipt line onto the (item, store) balance, branching on the
 * item's configured valuation method (Requirements 14.2–14.4):
 *
 *   WAVG     — costing/wavg-engine.ts recomputes the moving average (the same
 *              formula movements/domain.ts's weightedAvgRate uses, so results
 *              are byte-identical to before — see recomputeWavg's reuse below).
 *   FIFO     — costing/fifo-engine.ts backs a new cost_layers row; the stored
 *              rate is a derived reference only, floor-divided from the exact
 *              layer total (the authoritative value lives in the layers and is
 *              what the balances read path sums — see queries.ts).
 *   STANDARD — the rate is pinned to the item's configured unitCostMinor; the
 *              receipt's own price never moves it. This service has no
 *              purchase-price-variance posting, so that variance (actual vs.
 *              standard) is not booked anywhere — out of scope for this fix.
 *
 * Returns the new on-hand qty and the rate to post to stockBalances/the ledger.
 */

const VALID_VALUATION_METHODS = new Set(["WAVG", "FIFO", "STANDARD"]);

/**
 * `items.valuation_method` has no DB CHECK constraint — only the Zod schema
 * on the HTTP surface enforces the FIFO/WAVG/STANDARD enum, so a write that
 * bypasses Zod (e.g. a direct Drizzle insert) can leave an item with an
 * unrecognized value. Both postReceiptLine and postIssueLine branch on this
 * value with an `if (method === "FIFO") ... else if STANDARD ... else`
 * shape, so before this guard any other value silently fell through to the
 * WAVG code path with no indication the configured method was ever honored.
 * Fail loud instead: an unrecognized value is a deterministic data problem
 * (retrying the same message will not fix it), so dead-letter immediately —
 * same reasoning as assertSufficientStock's NonRetryableError above.
 */
function assertValidValuationMethod(method: string, itemId: string): void {
  if (!VALID_VALUATION_METHODS.has(method)) {
    throw new NonRetryableError(
      `item ${itemId} has an unrecognized valuationMethod "${method}" (expected FIFO, WAVG, or STANDARD) — refusing to silently default to WAVG`,
    );
  }
}

async function postReceiptLine(
  tx: Tx, tenantId: string, actorId: string, itemId: string, storeId: string,
  qty: number, rateMinor: bigint, currency: string, postingDate: string, receiptId: string,
): Promise<{ newQty: number; newRate: bigint }> {
  const valuation = await repo.getItemValuation(tx, tenantId, itemId);
  const method = valuation?.valuationMethod ?? "WAVG";
  assertValidValuationMethod(method, itemId);
  const cur = await repo.lockBalance(tx, tenantId, itemId, storeId);
  const newQty = cur.qty + qty;

  if (method === "FIFO") {
    const existingValue = await repo.sumOpenLayerValue(tx, tenantId, itemId, storeId);
    await repo.insertCostLayer(tx, {
      tenantId, itemId, warehouseId: storeId, receiptDate: new Date(postingDate),
      qty, remainingQty: qty, unitCostPaise: rateMinor, receiptId,
      createdBy: actorId, updatedBy: actorId,
    });
    const newValue = existingValue + BigInt(qty) * rateMinor;
    const newRate = newQty > 0 ? newValue / BigInt(newQty) : 0n;
    await repo.upsertBalance(tx, tenantId, itemId, storeId, newQty, newRate, currency);
    return { newQty, newRate };
  }

  const newRate = method === "STANDARD"
    ? valuation?.unitCostMinor ?? 0n
    : recomputeWavg(
        { qty: cur.qty, totalCostPaise: BigInt(cur.qty) * cur.rateMinor, unitCostPaise: cur.rateMinor },
        { qty, unitCostPaise: rateMinor },
      ).unitCostPaise;
  await repo.upsertBalance(tx, tenantId, itemId, storeId, newQty, newRate, currency);
  return { newQty, newRate };
}

/**
 * Post a single issue line, branching on valuation method:
 *
 *   FIFO             — consumes the oldest open cost_layers first via
 *                      costing/fifo-engine.ts; the exact consumed cost (not an
 *                      average) backs the GL posting and the ledger row.
 *   WAVG / STANDARD  — UNCHANGED: the balance's current rate applies (neither
 *                      method moves the rate on issue), so WAVG-configured
 *                      items behave byte-identically to before this change.
 *
 * Returns the new on-hand qty, the rate to post to stockBalances/the ledger,
 * and the exact cost of the issued quantity (for GL posting).
 */
async function postIssueLine(
  tx: Tx, tenantId: string, actorId: string, itemId: string, storeId: string,
  qty: number, currency: string,
): Promise<{ newQty: number; newRate: bigint; costOfIssuePaise: bigint }> {
  const valuation = await repo.getItemValuation(tx, tenantId, itemId);
  assertValidValuationMethod(valuation?.valuationMethod ?? "WAVG", itemId);
  const cur = await repo.lockBalance(tx, tenantId, itemId, storeId);
  // Same deterministic-rejection reasoning as issueCreate/transferCreate in
  // consumer.ts: a stock shortfall can never clear on retry, so it must
  // dead-letter immediately instead of exhausting the bus's retry/backoff
  // budget first (matches batches/items/srn: any DomainError from a
  // domain-rule check becomes a NonRetryableError).
  try {
    assertSufficientStock(cur.qty, qty);
  } catch (err) {
    if (err instanceof DomainError) throw new NonRetryableError(err.message);
    throw err;
  }
  const newQty = cur.qty - qty;

  if (valuation?.valuationMethod === "FIFO") {
    const layers = await repo.lockOpenFifoLayers(tx, tenantId, itemId, storeId);
    const result = consumeFifo(layers, qty);
    await repo.applyFifoConsumption(tx, tenantId, actorId, result.consumed, result.remaining);
    const remainingValue = result.remaining.reduce((s, l) => s + BigInt(l.remainingQty) * l.unitCostPaise, 0n);
    const newRate = newQty > 0 ? remainingValue / BigInt(newQty) : 0n;
    await repo.upsertBalance(tx, tenantId, itemId, storeId, newQty, newRate, currency);
    return { newQty, newRate, costOfIssuePaise: result.totalCostPaise };
  }

  await repo.upsertBalance(tx, tenantId, itemId, storeId, newQty, cur.rateMinor, currency);
  return { newQty, newRate: cur.rateMinor, costOfIssuePaise: valuationMinor(qty, cur.rateMinor) };
}

interface HeaderFields {
  postingDate: string;
  fromStoreId?: string | undefined; toStoreId?: string | undefined;
  refDoc?: string | undefined; refNo?: string | undefined; reasonCode?: string | undefined; notes?: string | undefined;
  grnNo?: string | undefined; poRef?: string | undefined; supplierId?: string | undefined;
}

async function insertHeader(tx: Tx, msg: CommandEnvelope, id: string, movementType: string, f: HeaderFields): Promise<void> {
  await repo.insertMovement(tx, {
    id, tenantId: msg.tenantId, movementType,
    refDoc: f.refDoc ?? null, refNo: f.refNo ?? null,
    postingDate: f.postingDate,
    fromStoreId: f.fromStoreId ?? null, toStoreId: f.toStoreId ?? null,
    reasonCode: f.reasonCode ?? null, notes: f.notes ?? null,
    grnNo: f.grnNo ?? null, poRef: f.poRef ?? null, supplierId: f.supplierId ?? null,
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
  await cache.invalidateResource(tenantId, RESOURCE.movement);
}
