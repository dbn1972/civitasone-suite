import { cache } from "../../shared/infra.js";
import * as employeeRepo from "../employee/repo.js";

type OrgNode = {
  id: string;
  name: string;
  designation: string;
  department: string;
  reportsTo?: string | null;
  children?: OrgNode[];
};

function buildSubtree(empId: string, active: Awaited<ReturnType<typeof employeeRepo.listByTenant>>): OrgNode {
  const emp = active.find((e) => e.id === empId)!;
  return {
    id: emp.id,
    name: emp.fullName,
    designation: emp.designationId.slice(0, 8),
    department: emp.departmentId.slice(0, 8),
    reportsTo: emp.managerId ?? null,
    children: active
      .filter((e) => e.managerId === empId)
      .map((e) => buildSubtree(e.id, active)),
  };
}

export async function getOrgChart(tenantId: string): Promise<OrgNode[]> {
  return cache.listOrLoad(tenantId, "org_chart", "tree", async () => {
    const rows = await employeeRepo.listByTenant(tenantId, 2000, 0);
    const active = rows.filter((e) => e.status !== "separated");
    const idSet = new Set(active.map((e) => e.id));
    const roots = active.filter((e) => !e.managerId || !idSet.has(e.managerId));
    return roots.map((e) => buildSubtree(e.id, active));
  }) as Promise<OrgNode[]>;
}
