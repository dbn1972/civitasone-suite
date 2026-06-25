/** dashboards query handlers (READ PATH) — read-through cache, tenant-scoped. */
import type { RequestContext } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import { DASHBOARD_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { canView } from "./access.js";
import type { DashboardView, WidgetView, ShareView } from "./schema.js";

export async function listDashboards(tenantId: string, limit: number, offset: number) {
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

export type DashboardDetail = DashboardView & { widgets: WidgetView[]; shares: ShareView[] };

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
  return { ...dashboard, widgets, shares };
}
