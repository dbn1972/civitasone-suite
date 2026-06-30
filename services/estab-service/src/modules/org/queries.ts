import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { rankOf, type OrgUnitType } from "./domain.js";
import type { OrgUnitRow } from "./schema.js";

export type OrgUnitDto = {
  id: string;
  code: string;
  name: string;
  type: string;
  rank: number;
  parentId: string | null;
  headOperatorId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

function toDto(r: OrgUnitRow): OrgUnitDto {
  return {
    id: r.id, code: r.code, name: r.name, type: r.type,
    rank: rankOf(r.type as OrgUnitType),
    parentId: r.parentId, headOperatorId: r.headOperatorId, active: r.active,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

export async function getOrgUnit(tenantId: string, id: string): Promise<OrgUnitDto | null> {
  const row = await cache.getOrLoad<OrgUnitRow>(
    cache.makeKey(tenantId, "org_unit", id),
    () => repo.findOrgUnitById(id, tenantId),
  );
  return row ? toDto(row) : null;
}

export async function listOrgUnits(
  tenantId: string,
  filter: { type?: string | undefined; parentId?: string | undefined; activeOnly: boolean },
  limit: number,
): Promise<OrgUnitDto[]> {
  const rows = await repo.listOrgUnits(tenantId, limit);
  return rows
    .filter((r) => (filter.type ? r.type === filter.type : true))
    .filter((r) => (filter.parentId ? r.parentId === filter.parentId : true))
    .filter((r) => (filter.activeOnly ? r.active : true))
    .map(toDto);
}

/** Ancestor chain (nearest parent first) up to the root — the channel of submission. */
export async function getAncestors(tenantId: string, id: string): Promise<OrgUnitDto[]> {
  const rows = await repo.listAncestors(tenantId, id);
  return rows.map(toDto);
}
