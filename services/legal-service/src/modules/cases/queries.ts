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
  // GAP-LEGAL-CASES-NEW-01: resolve the case-type CODE (`type`) so the web list
  // classifies by the explicit type when present (caseNo-prefix heuristic is the
  // web-side fallback for legacy cases with no caseTypeId).
  return cache.getOrLoad(cacheKey, () => repo.listCasesWithType(tenantId, status, caseTypeId));
}

/**
 * GAP-LEGAL-CASES-NEW-01: list the tenant's case-type master, projected to the
 * {id, code, name} the web create-case select and the list classification use.
 */
export async function listCaseTypes(tenantId: string): Promise<Array<{ id: string; code: string; name: string }>> {
  const cacheKey = cache.makeKey(tenantId, "case_types", "all");
  const rows = await cache.getOrLoad(cacheKey, () => repo.listCaseTypes(tenantId));
  return (rows ?? []).map((r) => ({ id: r.id, code: r.code, name: r.name }));
}
