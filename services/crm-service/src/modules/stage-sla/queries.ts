/**
 * G3 — Stage SLA policy queries (read-model handlers).
 */
import { findById, listByTenant } from "./repo.js";
import type { SLAPolicyView } from "./repo.js";

export async function getSLAPolicy(id: string, tenantId: string): Promise<SLAPolicyView | null> {
  return findById(id, tenantId);
}

export async function listSLAPolicies(
  tenantId: string,
  limit: number,
  offset: number,
  activeFilter?: boolean,
): Promise<{ data: SLAPolicyView[]; meta: { page: number; pageSize: number; total: number } }> {
  const data = await listByTenant(tenantId, limit, offset, activeFilter);
  return {
    data,
    meta: { page: Math.floor(offset / limit) + 1, pageSize: limit, total: data.length },
  };
}
