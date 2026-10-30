import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { LimitationRuleRow } from "./schema.js";

export async function getLimitation(id: string, tenantId: string): Promise<LimitationRuleRow | null> {
  const rule = await cache.getOrLoad<LimitationRuleRow>(
    cache.makeKey(tenantId, "limitation", id),
    async () => (await repo.findById(id)) ?? null,
  );
  // UAT W8-B: tenant-scoped like queries.getOpinion — another tenant's rule is "not found".
  if (rule && rule.tenantId !== tenantId) return null;
  return rule ?? null;
}

export async function listLimitations(
  tenantId: string,
  filters: { matterId?: string | undefined; status?: string | undefined },
  page: number,
  pageSize: number,
) {
  return repo.list(tenantId, filters, page, pageSize);
}
