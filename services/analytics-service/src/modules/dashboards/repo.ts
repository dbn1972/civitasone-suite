/**
 * dashboards repo — Drizzle queries against the `analytics` schema ONLY.
 * Every read/write is tenant-scoped. Updates use optimistic locking on the
 * `version` column (compare-and-set); a stale version affects 0 rows.
 */
import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  dashboards,
  dashboardWidgets,
  dashboardShares,
  type DashboardRow,
  type DashboardInsert,
  type DashboardView,
  type WidgetRow,
  type WidgetInsert,
  type WidgetView,
  type ShareRow,
  type ShareInsert,
  type ShareView,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export function toView(r: DashboardRow): DashboardView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    description: r.description,
    status: r.status,
    ownerId: r.ownerId,
    visibility: r.visibility,
    layout: r.layout ?? {},
    version: r.version,
  };
}

export function toWidgetView(r: WidgetRow): WidgetView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    dashboardId: r.dashboardId,
    title: r.title,
    vizType: r.vizType,
    spec: r.spec,
    position: r.position,
    version: r.version,
  };
}

export function toShareView(r: ShareRow): ShareView {
  return { id: r.id, dashboardId: r.dashboardId, principalId: r.principalId, access: r.access };
}

export async function findById(id: string, tenantId: string): Promise<DashboardView | null> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  return row ? toView(row) : null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DashboardView[]> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.tenantId, tenantId))
    .orderBy(desc(dashboards.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export async function insert(tx: Writer, row: DashboardInsert): Promise<void> {
  await tx.insert(dashboards).values(row);
}

/**
 * Optimistic-locked update. Returns true if a row at exactly `expectedVersion`
 * was updated; false on a version conflict (someone else changed it first).
 */
export async function updateWithVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  patch: Partial<Pick<DashboardRow, "name" | "description" | "status" | "visibility" | "layout">>,
  actorId: string,
): Promise<boolean> {
  const updated = await tx
    .update(dashboards)
    .set({ ...patch, updatedBy: actorId, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(
      and(
        eq(dashboards.id, id),
        eq(dashboards.tenantId, tenantId),
        eq(dashboards.version, expectedVersion),
      ),
    )
    .returning({ id: dashboards.id });
  return updated.length > 0;
}

// ── widgets ─────────────────────────────────────────────────────────────────
export async function insertWidget(tx: Writer, row: WidgetInsert): Promise<void> {
  await tx.insert(dashboardWidgets).values(row);
}

export async function listWidgets(dashboardId: string, tenantId: string): Promise<WidgetView[]> {
  const rows = await db
    .select()
    .from(dashboardWidgets)
    .where(and(eq(dashboardWidgets.dashboardId, dashboardId), eq(dashboardWidgets.tenantId, tenantId)))
    .orderBy(asc(dashboardWidgets.position));
  return rows.map(toWidgetView);
}

// ── shares ──────────────────────────────────────────────────────────────────
export async function upsertShare(tx: Writer, row: ShareInsert): Promise<void> {
  await tx
    .insert(dashboardShares)
    .values(row)
    .onConflictDoUpdate({
      target: [dashboardShares.tenantId, dashboardShares.dashboardId, dashboardShares.principalId],
      set: { access: row.access ?? "view" },
    });
}

export async function listShares(dashboardId: string, tenantId: string): Promise<ShareView[]> {
  const rows = await db
    .select()
    .from(dashboardShares)
    .where(and(eq(dashboardShares.dashboardId, dashboardId), eq(dashboardShares.tenantId, tenantId)));
  return rows.map(toShareView);
}
