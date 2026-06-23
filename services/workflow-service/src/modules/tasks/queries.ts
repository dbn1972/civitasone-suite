import { cache } from "../../shared/infra.js";
import { TASK_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

export async function getTask(id: string, tenantId: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, TASK_RESOURCE, id), () => repo.findById(id, tenantId));
}

export async function listTasks(
  tenantId: string,
  limit: number,
  offset: number,
  opts?: { status?: string; roles?: string[] },
) {
  const loader = async () => {
    const rows = opts?.status === "pending" && opts.roles?.length
      ? await repo.listPendingForRoles(tenantId, opts.roles, limit, offset)
      : await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  };

  const key = `list:${opts?.status ?? "all"}:${limit}:${offset}`;
  return cache.listOrLoad(tenantId, TASK_RESOURCE, key, loader);
}
