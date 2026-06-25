import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { CounselBriefRow } from "./schema.js";

export async function getBrief(id: string, tenantId: string): Promise<CounselBriefRow | null> {
  const row = await cache.getOrLoad<CounselBriefRow>(
    cache.makeKey(tenantId, "counsel_brief", id),
    () => repo.findBriefById(id),
  );
  if (row && row.tenantId !== tenantId) return null;
  return row;
}

export async function listBriefs(tenantId: string, caseId?: string, status?: string) {
  const cacheKey = cache.makeKey(tenantId, "counsel_briefs", `${caseId ?? "all"}:${status ?? "all"}`);
  return cache.getOrLoad(cacheKey, () => repo.listBriefs(tenantId, caseId, status));
}
