import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financePfms } from "../payments/schema.js";
import { financePfmsConfig } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPfmsBatch(tx: Writer, row: typeof financePfms.$inferInsert): Promise<void> {
  await tx.insert(financePfms).values(row);
}

export async function findPfmsById(id: string, tenantId: string) {
  const rows = await db.select().from(financePfms)
    .where(eq(financePfms.id, id))
    .limit(1);
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

export async function listPfmsByTenant(tenantId: string, limit = 50) {
  return db.select().from(financePfms)
    .where(eq(financePfms.tenantId, tenantId))
    .limit(limit);
}

export async function getTenantConfig(tenantId: string) {
  const rows = await db.select().from(financePfmsConfig)
    .where(eq(financePfmsConfig.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updatePfmsBatch(tx: Writer, id: string, patch: Partial<typeof financePfms.$inferInsert>): Promise<void> {
  await tx.update(financePfms).set({ ...patch, updatedAt: new Date() }).where(eq(financePfms.id, id));
}
