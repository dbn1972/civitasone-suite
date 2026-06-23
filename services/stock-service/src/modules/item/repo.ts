import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stockItems, stockUoms, type ItemInsert, type ItemRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type ItemWithUom = ItemRow & { uom: string | null };

export async function insertItem(tx: Writer, row: ItemInsert): Promise<void> {
  await tx.insert(stockItems).values(row);
}

export async function findItemById(id: string): Promise<ItemRow | null> {
  const rows = await db.select().from(stockItems).where(eq(stockItems.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findItemsByTenant(tenantId: string, opts?: { category?: string; limit?: number; offset?: number }): Promise<ItemRow[]> {
  return db.select().from(stockItems)
    .where(eq(stockItems.tenantId, tenantId))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

export async function findItemWithUomById(id: string): Promise<ItemWithUom | null> {
  const rows = await db
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
    .where(eq(stockItems.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findItemsWithUomByTenant(tenantId: string, opts?: { category?: string; limit?: number; offset?: number }): Promise<ItemWithUom[]> {
  return db
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
    .where(eq(stockItems.tenantId, tenantId))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}
