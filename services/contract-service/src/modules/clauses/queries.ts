import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ClauseRow } from "./schema.js";

export async function getClause(id: string, tenantId: string): Promise<ClauseRow | null> {
  const row = await cache.getOrLoad<ClauseRow | undefined>(
    cache.makeKey(tenantId, "clause", id),
    () => repo.findClauseById(id, tenantId),
  );
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listClauses(
  tenantId: string,
  opts: { limit: number; offset: number; category?: string; jurisdiction?: string },
): Promise<{ data: ClauseRow[]; total: number }> {
  return repo.listClauses(tenantId, opts);
}
