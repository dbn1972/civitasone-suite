import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ParaRow } from "./schema.js";

export async function getPara(id: string, tenantId: string): Promise<ParaRow | null> {
  return cache.getOrLoad<ParaRow>(
    cache.makeKey(tenantId, "para", id),
    () => repo.findParaById(id),
  );
}

export async function listParas(tenantId: string, status?: string, deptRef?: string, limit = 50, offset = 0) {
  const cacheKey = cache.makeKey(tenantId, "paras", `${status ?? "all"}:${deptRef ?? "all"}:${limit}:${offset}`);
  return cache.getOrLoad(cacheKey, async () => {
    const items = await repo.listParas(tenantId, status, deptRef, limit, offset);
    const total = await repo.listParasCount(tenantId, status, deptRef);
    return { items, total, limit, offset };
  });
}
