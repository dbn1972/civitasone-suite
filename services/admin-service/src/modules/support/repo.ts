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

// P1-3: break-glass review is a platform tool. When a target tenantId is given
// (super_admin only) the listing is scoped to that tenant; when omitted it is
// platform-wide, instead of being silently pinned to the caller's own ctx.tenantId.
export async function listBreakGlass(limit: number, tenantId?: string) {
  const base = db.select().from(adminBreakGlassLog);
  const filtered = tenantId
    ? base.where(eq(adminBreakGlassLog.tenantId, tenantId))
    : base;
  return filtered.limit(limit).orderBy(adminBreakGlassLog.openedAt);
}
