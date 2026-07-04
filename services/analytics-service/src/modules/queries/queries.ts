/** queries read handlers (READ PATH) — read-through cache, tenant-scoped. */
import { cache } from "../../shared/infra.js";
import { QUERY_RESOURCE, SCHEDULED_RESOURCE, EXPORT_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { QueryRunView } from "./schema.js";

function page<T>(rows: T[], limit: number, offset: number) {
  return {
    data: rows,
    pagination: {
      hasMore: rows.length === limit,
      pageSize: limit,
      ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
    },
  };
}

export async function getQueryRun(tenantId: string, id: string): Promise<QueryRunView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, QUERY_RESOURCE, id), () => repo.findById(id, tenantId));
}

export async function listQueryRuns(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, QUERY_RESOURCE, `list:${limit}:${offset}`, async () =>
    page(await repo.listByTenant(tenantId, limit, offset), limit, offset),
  );
}

export async function listScheduled(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, SCHEDULED_RESOURCE, `list:${limit}:${offset}`, async () =>
    page(await repo.listScheduled(tenantId, limit, offset), limit, offset),
  );
}

export async function listExports(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, EXPORT_RESOURCE, `list:${limit}:${offset}`, async () =>
    page(await repo.listExports(tenantId, limit, offset), limit, offset),
  );
}

export async function getExport(tenantId: string, id: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, EXPORT_RESOURCE, id), () => repo.findExportById(id, tenantId));
}
