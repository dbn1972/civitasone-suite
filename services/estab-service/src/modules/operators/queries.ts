import { getEmployeeDisplayMap } from "../../shared/hrms-client.js";
import * as repo from "./repo.js";
import type { OperatorRow } from "./schema.js";

export type OperatorDto = {
  id: string;
  employeeId: string;
  // GAP-ESTAB-OPERATORS-01: best-effort display name/department for employeeId
  // (an hrms id), resolved server-side via the estab→hrms employee-summaries
  // enrichment (same pattern as quarter-allotments employeeName / vehicles
  // assignedToName). Optional: absent when the directory lookup fails, so the
  // UI falls back to a truncated-id hint rather than a wrong name.
  employeeName?: string;
  departmentName?: string;
  division: string;
  section: string | null;
  deskRole: string;
  canInitiate: boolean;
  active: boolean;
  assignedBy: string;
  updatedAt: string;
};

export function toOperatorDto(
  r: OperatorRow,
  displayMap: Map<string, { fullName: string; departmentName: string }>,
): OperatorDto {
  const display = displayMap.get(r.employeeId);
  return {
    id: r.id,
    employeeId: r.employeeId,
    ...(display?.fullName ? { employeeName: display.fullName } : {}),
    ...(display?.departmentName ? { departmentName: display.departmentName } : {}),
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
  const displayMap = await getEmployeeDisplayMap(tenantId);
  return rows
    .filter((r) => (filter.division ? r.division === filter.division : true))
    .filter((r) => (filter.deskRole ? r.deskRole === filter.deskRole : true))
    .filter((r) => (filter.activeOnly ? r.active : true))
    .map((r) => toOperatorDto(r, displayMap));
}

export async function getOperator(tenantId: string, id: string): Promise<OperatorDto | null> {
  const row = await repo.findOperatorById(id, tenantId);
  if (!row) return null;
  const displayMap = await getEmployeeDisplayMap(tenantId);
  return toOperatorDto(row, displayMap);
}
