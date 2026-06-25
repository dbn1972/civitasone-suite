import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ContractRow } from "./schema.js";

export async function getContract(id: string, tenantId: string): Promise<ContractRow | null> {
  const row = await cache.getOrLoad<ContractRow>(
    cache.makeKey(tenantId, "contract", id),
    () => repo.findContractById(id),
  );
  // Defence: cache is keyed by tenant but enforce scope on read-through too.
  if (row && row.tenantId !== tenantId) return null;
  return row;
}

/** Contract detail enriched with its amendment ledger. */
export async function getContractDetail(id: string, tenantId: string): Promise<(ContractRow & { amendments: unknown[] }) | null> {
  const contract = await getContract(id, tenantId);
  if (!contract) return null;
  const amendments = await repo.listAmendments(id, tenantId);
  return { ...contract, amendments };
}

export async function listContracts(tenantId: string, limit: number): Promise<ContractRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "contract", `list:${limit}`),
    () => repo.listContractsByTenant(tenantId, limit),
    60,
  );
  return rows ?? [];
}

/** Read model: active contracts in force. */
export async function listActive(tenantId: string, limit: number): Promise<ContractRow[]> {
  return repo.listActiveByTenant(tenantId, limit);
}

/** Read model: active contracts expiring within `days` days from today. */
export async function listExpiring(tenantId: string, days: number, limit: number): Promise<ContractRow[]> {
  const before = new Date();
  before.setUTCDate(before.getUTCDate() + days);
  const beforeStr = before.toISOString().slice(0, 10);
  return repo.listExpiringByTenant(tenantId, beforeStr, limit);
}
