import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ContractRow } from "./schema.js";

export async function getContract(id: string, tenantId: string): Promise<ContractRow | null> {
  return cache.getOrLoad<ContractRow>(
    cache.makeKey(tenantId, "contract", id),
    () => repo.findContractById(id)
  );
}

export async function listContracts(tenantId: string, limit: number): Promise<ContractRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "contract", `list:${limit}`),
    () => repo.listContractsByTenant(tenantId, limit),
    60
  );
  return rows ?? [];
}
