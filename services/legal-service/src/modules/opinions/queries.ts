import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { OpinionRow } from "./schema.js";

export async function getOpinion(id: string, tenantId: string): Promise<OpinionRow | null> {
  const row = await cache.getOrLoad<OpinionRow>(
    cache.makeKey(tenantId, "opinion", id),
    () => repo.findOpinionById(id),
  );
  if (row && row.tenantId !== tenantId) return null;
  return row;
}

export async function listOpinions(tenantId: string, status?: string, caseId?: string) {
  const cacheKey = cache.makeKey(tenantId, "opinions", `${status ?? "all"}:${caseId ?? "all"}`);
  return cache.getOrLoad(cacheKey, () => repo.listOpinions(tenantId, status, caseId));
}
