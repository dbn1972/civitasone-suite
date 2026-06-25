import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { FilingRow } from "./schema.js";

export async function getFiling(id: string, tenantId: string): Promise<FilingRow | null> {
  const row = await cache.getOrLoad<FilingRow>(
    cache.makeKey(tenantId, "filing", id),
    () => repo.findFilingById(id),
  );
  if (row && row.tenantId !== tenantId) return null;
  return row;
}

export async function listFilings(tenantId: string, caseId?: string, filingType?: string, status?: string) {
  const cacheKey = cache.makeKey(tenantId, "filings", `${caseId ?? "all"}:${filingType ?? "all"}:${status ?? "all"}`);
  return cache.getOrLoad(cacheKey, () => repo.listFilings(tenantId, caseId, filingType, status));
}
