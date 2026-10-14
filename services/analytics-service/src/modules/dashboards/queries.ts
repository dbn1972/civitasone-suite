/** dashboards query handlers (READ PATH) — read-through cache, tenant-scoped. */
import type { RequestContext } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import { resolveActorNames } from "../../shared/hrms-client.js";
import { DASHBOARD_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { canView } from "./access.js";
import type { DashboardView, WidgetView, ShareView } from "./schema.js";

export async function listDashboards(tenantId: string, limit: number, offset: number) {
  const page = await listDashboardsCached(tenantId, limit, offset);
  // SF-17b: owner names are resolved per page (batched, tenant-scoped) outside the cache.
  const names = await resolveActorNames(tenantId, page.data.map((d) => d.ownerId));
  return { ...page, data: page.data.map((d) => ({ ...d, ownerName: d.ownerId ? (names.get(d.ownerId) ?? null) : null })) };
}

async function listDashboardsCached(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, DASHBOARD_RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}

export type DashboardDetail = DashboardView & { widgets: WidgetView[]; shares: ShareView[]; ownerName: string | null };

/**
 * Detail read with access enforcement: returns null when the dashboard is in
 * another tenant or the caller cannot view it (caller maps null → 404).
 */
export async function getDashboardDetail(ctx: RequestContext, id: string): Promise<DashboardDetail | null> {
  const dashboard = await repo.findById(id, ctx.tenantId);
  if (!dashboard) return null;
  const shares = await repo.listShares(id, ctx.tenantId);
  if (!canView(ctx, dashboard, shares)) return null;
  const widgets = await repo.listWidgets(id, ctx.tenantId);
  const owner = await resolveActorNames(ctx.tenantId, [dashboard.ownerId]);
  return { ...dashboard, widgets, shares, ownerName: dashboard.ownerId ? (owner.get(dashboard.ownerId) ?? null) : null };
}
