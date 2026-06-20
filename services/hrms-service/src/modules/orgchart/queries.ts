import { cache } from "../../shared/infra.js";
import * as employeeRepo from "../employee/repo.js";

export async function getOrgChart(tenantId: string) {
  return cache.listOrLoad(tenantId, "org_chart", "tree", async () => {
    const rows = await employeeRepo.listByTenant(tenantId, 500, 0);
    return rows
      .filter((e) => e.status !== "separated")
      .map((e) => ({
        id: e.id,
        name: e.fullName,
        designation: e.designationId.slice(0, 8),
        department: e.departmentId.slice(0, 8),
        reportsTo: undefined,
        children: [],
      }));
  });
}
