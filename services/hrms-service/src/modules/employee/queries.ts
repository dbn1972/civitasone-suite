import { eq } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import { hrmsDepartments } from "./schema.js";
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
    const depts = await db.select().from(hrmsDepartments).where(eq(hrmsDepartments.tenantId, tenantId));
    const deptNameById = new Map(depts.map((d) => [d.id, d.name]));
    return {
      data: rows.map((r) => ({
        id: r.id,
        employeeNo: r.employeeNo,
        name: r.fullName,
        department: deptNameById.get(r.departmentId) ?? r.departmentId.slice(0, 8),
        status: r.status === "confirmed" || r.status === "active" ? "Active" : r.status,
      })),
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length > 0 ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
