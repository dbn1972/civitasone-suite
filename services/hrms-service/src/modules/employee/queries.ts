import { eq } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import * as repo from "./repo.js";
import { hrmsDepartments, hrmsDesignations } from "./schema.js";
import type { EmployeeRow } from "./schema.js";

export async function getEmployee(id: string, tenantId: string): Promise<EmployeeRow | null> {
  return cache.getOrLoad<EmployeeRow>(
    cache.makeKey(tenantId, "employee", id),
    () => repo.findById(id, tenantId)
  );
}

export type EmployeeDetailShape = {
  id: string;
  employeeId: string;
  name: string;
  email?: string;
  phone?: string;
  department: string;
  designation: string;
  grade?: string;
  joiningDate: string;
  status: string;
  reportingTo?: string;
  postingLocation?: string;
};

/** Returns a shaped response matching EmployeeDetailSchema (web). */
export async function getEmployeeDetail(id: string, tenantId: string): Promise<EmployeeDetailShape | null> {
  const emp = await cache.getOrLoad<EmployeeRow>(
    cache.makeKey(tenantId, "employee", id),
    () => repo.findById(id, tenantId),
  );
  if (!emp) return null;

  const [dept] = await scopedRead((tx) =>
    tx.select({ name: hrmsDepartments.name })
      .from(hrmsDepartments)
      .where(eq(hrmsDepartments.id, emp.departmentId))
      .limit(1),
  );

  const [desig] = await scopedRead((tx) =>
    tx.select({ name: hrmsDesignations.name, payGrade: hrmsDesignations.payGrade })
      .from(hrmsDesignations)
      .where(eq(hrmsDesignations.id, emp.designationId))
      .limit(1),
  );

  return {
    id: emp.id,
    employeeId: emp.employeeNo,
    name: emp.fullName,
    department: dept?.name ?? "—",
    designation: desig?.name ?? "—",
    joiningDate: emp.dateOfJoining,
    status: emp.status,
    ...(emp.email        ? { email: emp.email }             : {}),
    ...(emp.mobile       ? { phone: emp.mobile }             : {}),
    ...(desig?.payGrade  ? { grade: desig.payGrade }         : {}),
    ...(emp.station      ? { postingLocation: emp.station }  : {}),
  };
}

export async function listEmployees(tenantId: string, limit: number, offset: number): Promise<{ data: Array<{ id: string; name: string; department: string; status: string }>; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, "employee", `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    const depts = await scopedRead((tx) => tx.select().from(hrmsDepartments).where(eq(hrmsDepartments.tenantId, tenantId)));
    const deptNameById = new Map(depts.map((d) => [d.id, d.name]));
    return {
      data: rows.map((r) => ({
        id: r.id,
        employeeNo: r.employeeNo,
        name: r.fullName,
        department: deptNameById.get(r.departmentId) ?? "—",
        employeeType: r.employeeType,
        basicMinor: Number(r.basicMinor ?? 0),
        status: r.status, // P1-5: canonical lowercase (see employee/status.ts)
      })),
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length > 0 ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
