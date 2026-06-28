import * as repo from "./repo.js";
import type { OperatorRow } from "./schema.js";

export type OperatorDto = {
  id: string;
  employeeId: string;
  division: string;
  section: string | null;
  deskRole: string;
  canInitiate: boolean;
  active: boolean;
  assignedBy: string;
  updatedAt: string;
};

function toDto(r: OperatorRow): OperatorDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    division: r.division,
    section: r.section,
    deskRole: r.deskRole,
    canInitiate: r.canInitiate,
    active: r.active,
    assignedBy: r.assignedBy,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listOperators(
  tenantId: string,
  filter: { division?: string | undefined; deskRole?: string | undefined; activeOnly: boolean },
  limit: number,
): Promise<OperatorDto[]> {
  const rows = await repo.listOperators(tenantId, limit);
  return rows
    .filter((r) => (filter.division ? r.division === filter.division : true))
    .filter((r) => (filter.deskRole ? r.deskRole === filter.deskRole : true))
    .filter((r) => (filter.activeOnly ? r.active : true))
    .map(toDto);
}

export async function getOperator(tenantId: string, id: string): Promise<OperatorDto | null> {
  const row = await repo.findOperatorById(id, tenantId);
  return row ? toDto(row) : null;
}
