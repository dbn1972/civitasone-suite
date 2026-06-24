import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { SchemeRow } from "./schema.js";

export async function getScheme(tenantId: string, id: string): Promise<SchemeRow | null> {
  const row = await cache.getOrLoad(
    cache.makeKey(tenantId, "scheme", id),
    () => repo.findSchemeById(id, tenantId)
  );
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listSchemes(tenantId: string, limit: number): Promise<SchemeRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "scheme", `list:${limit}`),
    () => repo.listSchemesByTenant(tenantId, limit),
    60
  );
  return rows ?? [];
}
