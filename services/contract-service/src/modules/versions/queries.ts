import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ContractVersionRow, RedlineRow } from "./schema.js";

export async function listVersions(
  contractId: string,
  tenantId: string,
  opts: { limit: number; offset: number },
): Promise<{ data: ContractVersionRow[]; total: number }> {
  return repo.listVersions(contractId, tenantId, opts);
}

export async function getRedlines(
  contractId: string,
  tenantId: string,
  versionNumber: number,
): Promise<RedlineRow[]> {
  const key = cache.makeKey(tenantId, "redline", `${contractId}:${versionNumber}`);
  return cache.getOrLoad<RedlineRow[]>(key, () =>
    repo.getRedlinesByVersion(contractId, tenantId, versionNumber),
  );
}

export async function getLatestVersion(
  contractId: string,
  tenantId: string,
): Promise<ContractVersionRow | undefined> {
  return repo.getLatestVersion(contractId, tenantId);
}

export async function getVersionByNumber(
  contractId: string,
  tenantId: string,
  versionNumber: number,
): Promise<ContractVersionRow | undefined> {
  return repo.getVersionByNumber(contractId, tenantId, versionNumber);
}
