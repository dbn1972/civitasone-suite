import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { CaseRow } from "./schema.js";

export async function getCase(id: string, tenantId: string): Promise<CaseRow | null> {
  return cache.getOrLoad<CaseRow>(
    cache.makeKey(tenantId, "case", id),
    () => repo.findCaseById(id),
  );
}

export async function listCases(tenantId: string, status?: string, caseTypeId?: string) {
  const cacheKey = cache.makeKey(tenantId, "cases", `${status ?? "all"}:${caseTypeId ?? "all"}`);
  return cache.getOrLoad(cacheKey, () => repo.listCases(tenantId, status, caseTypeId));
}
