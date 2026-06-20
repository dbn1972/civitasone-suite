import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stockItems, type ItemInsert, type ItemRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

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
