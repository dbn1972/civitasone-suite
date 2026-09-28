/**
 * movements repo — Drizzle queries against the `inventory` schema ONLY.
 * Balance reads on the write path take a row lock (FOR UPDATE) so concurrent
 * movements on the same (item, store) serialise instead of racing.
 */
import { eq, and, lte, gte, gt, desc, inArray, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  movements, movementLines, stockBalances, stockLedger,
  type MovementInsert, type MovementLineInsert, type LedgerInsert,
  type StockBalanceRow, type LedgerRow,
} from "./schema.js";
import { items } from "../items/schema.js";
import { costLayers, type CostLayerInsert } from "../costing/schema.js";
import type { CostLayer, ConsumedLayer } from "../costing/fifo-engine.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BalanceState { qty: number; rateMinor: bigint }

/** A balance row joined with its item's valuation method (read path). */
export interface StockBalanceWithMethod extends StockBalanceRow { valuationMethod: string }

// ── Movement header + lines ──────────────────────────────────────────────

export async function insertMovement(tx: Writer, row: MovementInsert): Promise<void> {
  await tx.insert(movements).values(row);
}

export async function insertMovementLines(tx: Writer, rows: MovementLineInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(movementLines).values(rows);
}

export async function appendLedger(tx: Writer, row: LedgerInsert): Promise<void> {
  await tx.insert(stockLedger).values(row);
}

// ── Stock balances ─────────────────────────────────────────────────────────

/** Read + lock the current balance for an (item, store) inside the write tx. */
export async function lockBalance(tx: Tx, tenantId: string, itemId: string, storeId: string): Promise<BalanceState> {
  const rows = await tx.select().from(stockBalances)
    .where(and(
      eq(stockBalances.tenantId, tenantId),
      eq(stockBalances.itemId, itemId),
      eq(stockBalances.storeId, storeId),
    ))
    .limit(1)
    .for("update");
  const row = rows[0];
  return { qty: row?.onHandQty ?? 0, rateMinor: row?.avgRateMinor ?? 0n };
}

/** Insert or update the (item, store) balance, bumping its optimistic version. */
export async function upsertBalance(
  tx: Writer, tenantId: string, itemId: string, storeId: string,
  qty: number, rateMinor: bigint, currency: string,
): Promise<void> {
  await (tx as typeof db).insert(stockBalances)
    .values({ tenantId, itemId, storeId, onHandQty: qty, avgRateMinor: rateMinor, currency, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [stockBalances.tenantId, stockBalances.itemId, stockBalances.storeId],
      set: { onHandQty: qty, avgRateMinor: rateMinor, currency, updatedAt: new Date(), version: sql`${stockBalances.version} + 1` },
    });
}

/** Balances joined with each item's valuation method, so the read path can
 * value a FIFO item from its cost layers instead of qty × avgRateMinor. */
export async function listBalances(
  tenantId: string, opts: { itemId?: string; storeId?: string; limit: number; offset: number },
): Promise<StockBalanceWithMethod[]> {
  const conds: SQL[] = [eq(stockBalances.tenantId, tenantId)];
  if (opts.itemId) conds.push(eq(stockBalances.itemId, opts.itemId));
  if (opts.storeId) conds.push(eq(stockBalances.storeId, opts.storeId));
  return scopedRead((tx) => tx.select({
    id: stockBalances.id,
    tenantId: stockBalances.tenantId,
    itemId: stockBalances.itemId,
    storeId: stockBalances.storeId,
    onHandQty: stockBalances.onHandQty,
    avgRateMinor: stockBalances.avgRateMinor,
    currency: stockBalances.currency,
    updatedAt: stockBalances.updatedAt,
    version: stockBalances.version,
    valuationMethod: sql<string>`COALESCE(${items.valuationMethod}, 'WAVG')`,
  })
    .from(stockBalances)
    .leftJoin(items, and(eq(stockBalances.itemId, items.id), eq(stockBalances.tenantId, items.tenantId)))
    .where(and(...conds))
    .limit(opts.limit).offset(opts.offset));
}

// ── Item valuation (WAVG / FIFO / STANDARD) ─────────────────────────────────

export interface ItemValuation { valuationMethod: string; unitCostMinor: bigint }

/** Read an item's configured valuation method + standard cost, inside the write tx. */
export async function getItemValuation(tx: Tx, tenantId: string, itemId: string): Promise<ItemValuation | null> {
  const rows = await tx.select({ valuationMethod: items.valuationMethod, unitCostMinor: items.unitCostMinor })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

// ── Cost layers (FIFO valuation, NOTE below on warehouseId) ─────────────────
//
// cost_layers is keyed by (tenant, item, warehouse) but movements/stockBalances
// are keyed by (tenant, item, store) — the `stores` and `warehouses` schemas
// carry no link between them anywhere in this service (no FK, no join, no
// populated column), so a store's warehouse cannot be resolved. storeId is
// used as cost_layers.warehouseId: it is the only location key the receipt/
// issue boundary has, and it is what stockBalances already uses as the source
// of truth for qty. If a real store→warehouse hierarchy is wired up later,
// this mapping should be revisited.

/** Read + lock (FOR UPDATE) the open (remainingQty > 0) FIFO layers for an
 * (item, store), oldest-first — consumeFifo() re-sorts, but a stable, explicit
 * order here keeps same-day receipts deterministic across repeated reads. */
export async function lockOpenFifoLayers(tx: Tx, tenantId: string, itemId: string, warehouseId: string): Promise<CostLayer[]> {
  const rows = await tx.select().from(costLayers)
    .where(and(
      eq(costLayers.tenantId, tenantId),
      eq(costLayers.itemId, itemId),
      eq(costLayers.warehouseId, warehouseId),
      gt(costLayers.remainingQty, 0),
    ))
    .orderBy(costLayers.receiptDate, costLayers.createdAt)
    .for("update");
  return rows.map((r) => ({
    id: r.id, receiptDate: r.receiptDate, qty: r.qty, remainingQty: r.remainingQty, unitCostPaise: r.unitCostPaise,
  }));
}

/** Sum the value of all currently-open FIFO layers for an (item, store). */
export async function sumOpenLayerValue(tx: Tx, tenantId: string, itemId: string, warehouseId: string): Promise<bigint> {
  const rows = await tx.select({
    value: sql<string>`COALESCE(SUM(${costLayers.remainingQty} * ${costLayers.unitCostPaise}), 0)`,
  })
    .from(costLayers)
    .where(and(
      eq(costLayers.tenantId, tenantId),
      eq(costLayers.itemId, itemId),
      eq(costLayers.warehouseId, warehouseId),
      gt(costLayers.remainingQty, 0),
    ));
  return BigInt(rows[0]?.value ?? "0");
}

/** Insert a new FIFO cost layer for a receipt. */
export async function insertCostLayer(tx: Writer, row: CostLayerInsert): Promise<void> {
  await tx.insert(costLayers).values(row);
}

/** Persist a FIFO consumption: every touched layer's remainingQty is updated —
 * 0 for a layer fully depleted (absent from `remaining`), else its new value. */
export async function applyFifoConsumption(
  tx: Writer, tenantId: string, actorId: string, consumed: ConsumedLayer[], remaining: CostLayer[],
): Promise<void> {
  const remainingById = new Map(remaining.map((l) => [l.id, l.remainingQty]));
  for (const c of consumed) {
    const newRemainingQty = remainingById.get(c.layerId) ?? 0;
    await (tx as typeof db).update(costLayers)
      .set({ remainingQty: newRemainingQty, updatedAt: new Date(), updatedBy: actorId, version: sql`${costLayers.version} + 1` })
      .where(and(eq(costLayers.id, c.layerId), eq(costLayers.tenantId, tenantId)));
  }
}

/** Batched open-layer valuation for the read path: sums remaining layer value
 * per (item, store) for every FIFO itemId given, in one query (no N+1 across a
 * balances page). Keyed identically to how `listBalances` will look it up. */
export async function sumOpenLayerValues(tenantId: string, itemIds: string[]): Promise<Map<string, bigint>> {
  if (itemIds.length === 0) return new Map();
  const rows = await scopedRead((tx) => tx.select({
    itemId: costLayers.itemId,
    warehouseId: costLayers.warehouseId,
    value: sql<string>`COALESCE(SUM(${costLayers.remainingQty} * ${costLayers.unitCostPaise}), 0)`,
  })
    .from(costLayers)
    .where(and(eq(costLayers.tenantId, tenantId), inArray(costLayers.itemId, itemIds), gt(costLayers.remainingQty, 0)))
    .groupBy(costLayers.itemId, costLayers.warehouseId));
  const map = new Map<string, bigint>();
  for (const r of rows) map.set(`${r.itemId}|${r.warehouseId}`, BigInt(r.value));
  return map;
}

// ── Stock ledger ─────────────────────────────────────────────────────────

export async function listLedger(
  tenantId: string, opts: { itemId?: string; storeId?: string; from?: string; to?: string; limit: number; offset: number },
): Promise<LedgerRow[]> {
  const conds: SQL[] = [eq(stockLedger.tenantId, tenantId)];
  if (opts.itemId) conds.push(eq(stockLedger.itemId, opts.itemId));
  if (opts.storeId) conds.push(eq(stockLedger.storeId, opts.storeId));
  if (opts.from) conds.push(gte(stockLedger.postingDate, opts.from));
  if (opts.to) conds.push(lte(stockLedger.postingDate, opts.to));
  return scopedRead((tx) => tx.select().from(stockLedger)
    .where(and(...conds))
    .orderBy(desc(stockLedger.createdAt))
    .limit(opts.limit).offset(opts.offset));
}

// ── Low-stock report ─────────────────────────────────────────────────────

export interface LowStockRow {
  itemId: string;
  storeId: string;
  name: string;
  sku: string | null;
  onHandQty: number;
  reorderLevel: number;
  reorderQty: number;
}

/**
 * Items whose on-hand at a store has fallen to/below a positive reorder level.
 * Joins balances to the item master so the report carries the reorder policy.
 */
export async function listLowStock(tenantId: string, limit: number, offset: number): Promise<LowStockRow[]> {
  const rows = await scopedRead((tx) => tx.select({
    itemId: stockBalances.itemId,
    storeId: stockBalances.storeId,
    name: items.name,
    sku: items.sku,
    onHandQty: stockBalances.onHandQty,
    reorderLevel: items.reorderLevel,
    reorderQty: items.reorderQty,
  })
    .from(stockBalances)
    .innerJoin(items, and(eq(stockBalances.itemId, items.id), eq(stockBalances.tenantId, items.tenantId)))
    .where(and(
      eq(stockBalances.tenantId, tenantId),
      gte(items.reorderLevel, 1),
      lte(stockBalances.onHandQty, items.reorderLevel),
    ))
    .limit(limit).offset(offset));
  return rows;
}

/** Read reorder policy for an item (used by the consumer's low-stock check). */
export async function getReorderPolicy(tx: Tx, tenantId: string, itemId: string): Promise<{ reorderLevel: number; reorderQty: number } | null> {
  const rows = await tx.select({ reorderLevel: items.reorderLevel, reorderQty: items.reorderQty })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}
