import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ConfigView, RunView } from "./repo.js";

const RESOURCE = "due_horizon_config";

export async function getConfig(id: string, tenantId: string): Promise<ConfigView | null> {
  return cache.getOrLoad<ConfigView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findConfigById(id, tenantId),
  );
}

export async function listConfigs(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ data: ConfigView[]; meta: { page: number; pageSize: number; total: number } }> {
  const rows = await repo.listConfigs(tenantId, limit, offset);
  return {
    data: rows,
    meta: { page: Math.floor(offset / limit) + 1, pageSize: limit, total: rows.length },
  };
}

export async function listRuns(
  tenantId: string,
  limit: number,
  offset: number,
  configId?: string,
): Promise<{ data: RunView[]; meta: { page: number; pageSize: number; total: number } }> {
  const rows = await repo.listRuns(tenantId, limit, offset, configId);
  return {
    data: rows,
    meta: { page: Math.floor(offset / limit) + 1, pageSize: limit, total: rows.length },
  };
}
