import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabChargeHandover } from "./schema.js";
import type { HandoverRow, HandoverInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findHandoverById(id: string, tenantId: string): Promise<HandoverRow | null> {
  const rows = await db.select().from(estabChargeHandover)
    .where(eq(estabChargeHandover.id, id)).limit(1);
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

export async function listHandovers(tenantId: string, limit: number): Promise<HandoverRow[]> {
  return db.select().from(estabChargeHandover)
    .where(eq(estabChargeHandover.tenantId, tenantId))
    .orderBy(desc(estabChargeHandover.createdAt))
    .limit(limit);
}

export async function insertHandover(tx: Writer, row: HandoverInsert): Promise<void> {
  await tx.insert(estabChargeHandover).values(row);
}

export async function updateHandover(tx: Writer, id: string, patch: Partial<HandoverInsert>): Promise<void> {
  await tx.update(estabChargeHandover).set({ ...patch, updatedAt: new Date() }).where(eq(estabChargeHandover.id, id));
}
