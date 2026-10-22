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
  opts?: { status?: string; roles?: string[]; instanceId?: string; refType?: string },
) {
  const loader = async () => {
    // D1 (FE↔BE high ROI) — instanceId takes priority over the role-scoped
    // pending inbox: a caller viewing one instance's task list wants every
    // task on it, not just the ones targeted at their own roles.
    // GAP-HR-LEAVE-APPROVALS-02 — opts.refType narrows every branch in SQL
    // (and its total below), so a module inbox is never crowded out of the
    // first page by other modules' tasks.
    const refType = opts?.refType;
    const rows = opts?.instanceId
      ? await repo.listByInstance(tenantId, opts.instanceId, limit, offset, refType)
      : opts?.status === "pending" && opts.roles?.length
        ? await repo.listPendingForRoles(tenantId, opts.roles, limit, offset, refType)
        : await repo.listByTenant(tenantId, limit, offset, refType);
    // GAP-APPROVALS-HOME-01 — the exact total of the WHOLE (unpaged) matching
    // set, computed with the same filter the page just used, so the unified
    // approvals inbox can show a real Pending count / "N of M" instead of only
    // the length of the first page (which silently capped an approver's inbox
    // at `limit`). Cheap COUNT(*) on the already-tenant-scoped, indexed filter.
    const total = opts?.instanceId
      ? await repo.countByInstance(tenantId, opts.instanceId, refType)
      : opts?.status === "pending" && opts.roles?.length
        ? await repo.countPendingForRoles(tenantId, opts.roles, refType)
        : await repo.countByTenant(tenantId, refType);
    const subjects = await repo.instanceSummaries(tenantId, rows.map((r) => r.instanceId));
    const enriched = rows.map((r) => {
      const s = subjects.get(r.instanceId);
      return s ? { ...r, instanceName: s.name, requesterId: s.requesterId } : r;
    });
    return {
      data: enriched,
      pagination: {
        hasMore: offset + rows.length < total,
        pageSize: limit,
        total,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  };

  const key = `list:${opts?.status ?? "all"}:${opts?.instanceId ?? "-"}:${opts?.refType ?? "-"}:${limit}:${offset}`;
  return cache.listOrLoad(tenantId, TASK_RESOURCE, key, loader);
}

/** GAP-HR-LEAVE-APPROVALS-04 — see repo.openTaskRefIdsForActor. Uncached: authorisation data. */
export async function openTaskRefIds(
  tenantId: string,
  refType: string,
  refIds: string[],
  actorId: string,
  roles: string[],
): Promise<string[]> {
  return repo.openTaskRefIdsForActor(tenantId, refType, refIds, actorId, roles);
}
