import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { EmployeeRow } from "./schema.js";

export async function getEmployee(id: string, tenantId: string): Promise<EmployeeRow | null> {
  return cache.getOrLoad<EmployeeRow>(
    cache.makeKey(tenantId, "employee", id),
    () => repo.findById(id, tenantId)
  );
}

export async function listEmployees(tenantId: string, limit: number, offset: number): Promise<{ data: Array<{ id: string; name: string; department: string; status: string }>; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, "employee", `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows.map((r) => ({
        id: r.employeeNo,
        name: r.fullName,
        department: r.departmentId.slice(0, 8),
        status: r.status === "active" ? "Active" : r.status,
      })),
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length > 0 ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
