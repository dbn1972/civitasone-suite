import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { adminBreakGlassLog, type AdminBreakGlassLogInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertBreakGlass(tx: Writer, row: AdminBreakGlassLogInsert): Promise<void> {
  await tx.insert(adminBreakGlassLog).values(row);
}

export async function closeBreakGlass(tx: Writer, id: string, actorId: string): Promise<void> {
  await tx.update(adminBreakGlassLog).set({ closedAt: new Date(), updatedBy: actorId, updatedAt: new Date() })
    .where(eq(adminBreakGlassLog.id, id));
}

export async function listBreakGlass(tenantId: string, limit: number) {
  return db.select().from(adminBreakGlassLog)
    .where(eq(adminBreakGlassLog.tenantId, tenantId))
    .limit(limit)
    .orderBy(adminBreakGlassLog.openedAt);
}
