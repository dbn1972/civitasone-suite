import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { adminBreakGlassLog, type AdminBreakGlassLogInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type BreakGlassRow = typeof adminBreakGlassLog.$inferSelect;

export async function insertBreakGlass(tx: Writer, row: AdminBreakGlassLogInsert): Promise<void> {
  await tx.insert(adminBreakGlassLog).values(row);
}

// P1-3: only close a still-open grant (closed_at IS NULL guard) and return the
// row that was actually closed so the caller can emit an event / audit under the
// grant's own tenant. A re-close matches no row and returns undefined (no-op).
export async function closeBreakGlass(
  tx: Writer,
  id: string,
  actorId: string,
  reason = "manual",
): Promise<BreakGlassRow | undefined> {
  const now = new Date();
  const rows = await tx.update(adminBreakGlassLog)
    .set({ closedAt: now, updatedBy: actorId, updatedAt: now })
    .where(and(eq(adminBreakGlassLog.id, id), isNull(adminBreakGlassLog.closedAt)))
    .returning();
  return rows[0];
}

// P1-2: TTL sweeper -- grants whose expiresAt has passed and that are still open.
export async function findExpiredOpen(tx: Writer, now: Date, limit = 100): Promise<BreakGlassRow[]> {
  return tx.select().from(adminBreakGlassLog)
    .where(and(isNull(adminBreakGlassLog.closedAt), lte(adminBreakGlassLog.expiresAt, now)))
    .limit(limit);
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
