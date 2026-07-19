import { and, eq, isNull, lte } from "drizzle-orm";
import { db, scopedRead, scopedPlatformRead } from "../../shared/db.js";
import { adminBreakGlassLog, type AdminBreakGlassLogInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type BreakGlassRow = typeof adminBreakGlassLog.$inferSelect;

export async function insertBreakGlass(tx: Writer, row: AdminBreakGlassLogInsert): Promise<void> {
  await tx.insert(adminBreakGlassLog).values(row);
}

// P0: enforce one OPEN grant per tenant. The partial-unique index
// (admin_break_glass_one_open_per_tenant) is the source of truth; this read lets
// the consumer short-circuit a duplicate open into a clean no-op instead of
// relying on a caught unique-violation (which would still poison the message bus
// when the violation surfaces only at COMMIT).
export async function findOpenByTenant(tx: Writer, tenantId: string): Promise<BreakGlassRow | undefined> {
  const rows = await tx.select().from(adminBreakGlassLog)
    .where(and(eq(adminBreakGlassLog.tenantId, tenantId), isNull(adminBreakGlassLog.closedAt)))
    .limit(1);
  return rows[0];
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

// P1-2: TTL sweeper -- grants whose expiresAt has passed and that are still
// open, scoped to ONE tenant. Used by the per-tenant sweeper loop (see
// findExpiredOpenTenantIds + consumer.ts's sweepExpiredBreakGlass): the caller
// must already be running inside runWithTenant(tenantId, ...) for this to see
// that tenant's rows under strict RLS.
export async function findExpiredOpen(tx: Writer, now: Date, limit = 100): Promise<BreakGlassRow[]> {
  return tx.select().from(adminBreakGlassLog)
    .where(and(isNull(adminBreakGlassLog.closedAt), lte(adminBreakGlassLog.expiresAt, now)))
    .limit(limit);
}

// P1-2: sweeper step 1 — find the DISTINCT tenant ids that have at least one
// still-open, expired grant, across ALL tenants. This is the one genuinely
// cross-tenant read the sweeper needs (it has no single tenant of its own —
// it's a bare setInterval job, not tied to a request or a queue message), so
// it uses scopedPlatformRead() (migration 0011's app.platform_bypass SELECT
// policy). It returns only tenant ids, never row content, keeping the
// bypassed read's blast radius minimal; step 2 (closing each grant) then runs
// per-tenant under that tenant's own strict-RLS GUC via runWithTenant.
export async function findExpiredOpenTenantIds(now: Date, limit = 500): Promise<string[]> {
  const rows = await scopedPlatformRead((tx) => tx
    .selectDistinct({ tenantId: adminBreakGlassLog.tenantId })
    .from(adminBreakGlassLog)
    .where(and(isNull(adminBreakGlassLog.closedAt), lte(adminBreakGlassLog.expiresAt, now)))
    .limit(limit));
  return rows.map((r) => r.tenantId);
}

// P1-3: break-glass review is a platform tool. When a target tenantId is given
// (super_admin only) the listing is scoped to that tenant; when omitted it is
// platform-wide, instead of being silently pinned to the caller's own ctx.tenantId.
// Platform-wide review tool (super_admin only, see routes.ts) when tenantId is
// omitted; scoped to a specific tenant when given. The caller's per-request
// RLS GUC is always the CALLER's own JWT tenant (see app.ts's onRequest
// hook), which is fine for the scoped case but would silently filter the
// platform-wide case down to just the caller's tenant — so the unscoped
// listing uses scopedPlatformRead() (migration 0011's app.platform_bypass
// SELECT policy) instead of scopedRead(). The tenantId-scoped case keeps
// using the normal strict-RLS scopedRead() path (no bypass needed or wanted).
export async function listBreakGlass(limit: number, tenantId?: string) {
  if (tenantId) {
    return scopedRead((tx) => tx.select().from(adminBreakGlassLog)
      .where(eq(adminBreakGlassLog.tenantId, tenantId))
      .limit(limit).orderBy(adminBreakGlassLog.openedAt));
  }
  return scopedPlatformRead((tx) => tx.select().from(adminBreakGlassLog)
    .limit(limit).orderBy(adminBreakGlassLog.openedAt));
}
