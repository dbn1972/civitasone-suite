import { eq, and, asc, sql, type SQL } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { stockValuationRates } from "../valuation/schema.js";
import { stockItems, stockUoms, stockItemCategories, type ItemInsert, type ItemRow, type ItemCategoryRow, type UomRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type ItemWithUom = ItemRow & { uom: string | null };

export async function insertItem(tx: Writer, row: ItemInsert): Promise<void> {
  await tx.insert(stockItems).values(row);
}

export async function findItemById(id: string, tenantId: string): Promise<ItemRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(stockItems)
      .where(and(eq(stockItems.id, id), eq(stockItems.tenantId, tenantId))).limit(1);
    return rows[0] ?? null;
  }));
}

export async function findItemsByTenant(tenantId: string, opts?: { category?: string; limit?: number; offset?: number }): Promise<ItemRow[]> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) =>
    tx.select().from(stockItems)
      .where(eq(stockItems.tenantId, tenantId))
      .limit(opts?.limit ?? 50)
      .offset(opts?.offset ?? 0)
  ));
}

export async function findItemWithUomById(id: string, tenantId: string): Promise<ItemWithUom | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx
      .select({
        id: stockItems.id,
        tenantId: stockItems.tenantId,
        name: stockItems.name,
        code: stockItems.code,
        categoryId: stockItems.categoryId,
        uomId: stockItems.uomId,
        itemType: stockItems.itemType,
        reorderLevel: stockItems.reorderLevel,
        reorderQty: stockItems.reorderQty,
        valuationMethod: stockItems.valuationMethod,
        isActive: stockItems.isActive,
        createdAt: stockItems.createdAt,
        updatedAt: stockItems.updatedAt,
        createdBy: stockItems.createdBy,
        updatedBy: stockItems.updatedBy,
        version: stockItems.version,
        uom: stockUoms.symbol,
      })
      .from(stockItems)
      .leftJoin(stockUoms, eq(stockItems.uomId, stockUoms.id))
      .where(and(eq(stockItems.id, id), eq(stockItems.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }));
}

const likeEscape = (v: string): string => v.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function findItemsWithUomByTenant(tenantId: string, opts?: { category?: string; q?: string; limit?: number; offset?: number }): Promise<ItemWithUom[]> {
  const conds: SQL[] = [eq(stockItems.tenantId, tenantId)];
  if (opts?.category) conds.push(eq(stockItems.categoryId, opts.category));
  if (opts?.q) {
    const pat = `%${likeEscape(opts.q)}%`;
    conds.push(sql`(${stockItems.name} ILIKE ${pat} ESCAPE '\\' OR ${stockItems.code} ILIKE ${pat} ESCAPE '\\')`);
  }
  return runWithTenant(tenantId, () => scopedRead(async (tx) =>
    tx
      .select({
        id: stockItems.id,
        tenantId: stockItems.tenantId,
        name: stockItems.name,
        code: stockItems.code,
        categoryId: stockItems.categoryId,
        uomId: stockItems.uomId,
        itemType: stockItems.itemType,
        reorderLevel: stockItems.reorderLevel,
        reorderQty: stockItems.reorderQty,
        valuationMethod: stockItems.valuationMethod,
        isActive: stockItems.isActive,
        createdAt: stockItems.createdAt,
        updatedAt: stockItems.updatedAt,
        createdBy: stockItems.createdBy,
        updatedBy: stockItems.updatedBy,
        version: stockItems.version,
        uom: stockUoms.symbol,
      })
      .from(stockItems)
      .leftJoin(stockUoms, eq(stockItems.uomId, stockUoms.id))
      .where(and(...conds))
      // Stable order: limit/offset pages must not skip or repeat rows.
      .orderBy(asc(stockItems.name), asc(stockItems.id))
      .limit(opts?.limit ?? 50)
      .offset(opts?.offset ?? 0)
  ));
}

export type ItemBalances = {
  itemId: string;
  totalQty: number;
  totalValueMinor: string;
  warehouses: Array<{ warehouseId: string; qty: number; rateMinor: string; valueMinor: string }>;
};

/** Per-warehouse on-hand quantity and valuation of one item (read-only; minor units as strings). */
export async function findItemBalances(itemId: string, tenantId: string): Promise<ItemBalances> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(stockValuationRates)
      .where(and(eq(stockValuationRates.tenantId, tenantId), eq(stockValuationRates.itemId, itemId)))
      .orderBy(asc(stockValuationRates.warehouseId));
    let totalQty = 0;
    let totalValue = 0n;
    const warehouses = rows.map((r) => {
      const value = BigInt(r.qty) * r.rateMinor;
      totalQty += r.qty;
      totalValue += value;
      return { warehouseId: r.warehouseId, qty: r.qty, rateMinor: r.rateMinor.toString(), valueMinor: value.toString() };
    });
    return { itemId, totalQty, totalValueMinor: totalValue.toString(), warehouses };
  }));
}

export async function findCategoriesByTenant(tenantId: string, limit = 200): Promise<ItemCategoryRow[]> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) =>
    tx.select().from(stockItemCategories)
      .where(eq(stockItemCategories.tenantId, tenantId))
      .limit(limit)
  ));
}

export async function findUomsByTenant(tenantId: string, limit = 200): Promise<UomRow[]> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) =>
    tx.select().from(stockUoms)
      .where(eq(stockUoms.tenantId, tenantId))
      .limit(limit)
  ));
}
