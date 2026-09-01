import * as repo from "./repo.js";
import type { SiloProvisionRow } from "./schema.js";

export type SiloProvisionDto = {
  id: string;
  tenantId: string;
  dbName: string;
  status: string;
  steps: Array<{ step: string; ok: boolean; detail?: string }>;
  error: string | null;
  requestedAt: string;
  readyAt: string | null;
};

function toDto(r: SiloProvisionRow): SiloProvisionDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    dbName: r.dbName,
    status: r.status,
    steps: Array.isArray(r.steps) ? (r.steps as SiloProvisionDto["steps"]) : [],
    error: r.error,
    requestedAt: r.requestedAt.toISOString(),
    readyAt: r.readyAt?.toISOString() ?? null,
  };
}

export async function listProvisions(tenantId: string, limit: number, status?: string): Promise<SiloProvisionDto[]> {
  return (await repo.listForTenant(tenantId, limit, status)).map(toDto);
}

export async function getProvision(id: string, tenantId: string): Promise<SiloProvisionDto | null> {
  const r = await repo.findByIdForTenant(id, tenantId);
  return r ? toDto(r) : null;
}
