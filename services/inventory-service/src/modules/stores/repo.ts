import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stores, type StoreInsert, type StoreRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertStore(tx: Writer, row: StoreInsert): Promise<void> {
  await tx.insert(stores).values(row);
}

export async function findStore(tenantId: string, id: string): Promise<StoreRow | null> {
  const rows = await db.select().from(stores)
    .where(and(eq(stores.id, id), eq(stores.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listStores(tenantId: string, limit: number, offset: number): Promise<StoreRow[]> {
  return db.select().from(stores)
    .where(eq(stores.tenantId, tenantId))
    .limit(limit).offset(offset);
}
