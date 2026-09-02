import { eq } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { maskValue } from "../../shared/pii-mask.js";
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
  confirmationDate?: string;
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

  // HR-A deep-verify finding: managerId is a real column (settable via both
  // employee edit forms) and `reportingTo` is a declared field on both the
  // shared EmployeeDetailSchema (packages/schemas/src/web.ts) and the
  // EmployeeDetail type -- and is rendered on the detail page -- but this
  // function never populated it, so "Reports To" could never appear even
  // after successfully setting a manager. Resolve to the manager's name the
  // same way dept/designation are resolved above, scoped to the same tenant.
  const manager = emp.managerId ? await repo.findById(emp.managerId, tenantId) : null;

  return {
    id: emp.id,
    employeeId: emp.employeeNo,
    name: emp.fullName,
    department: dept?.name ?? "—",
    designation: desig?.name ?? "—",
    joiningDate: emp.dateOfJoining,
    status: emp.status,
    ...(emp.email          ? { email: emp.email }                     : {}),
    // SECURITY: pii-mask.ts declares that PII columns (including mobile)
    // must never be returned in full in ANY API response. This endpoint is
    // reachable by every READER_ROLES member (hr_admin, hr_officer,
    // super_admin, manager) for ANY employee in the tenant, not just direct
    // reports -- and self-service/routes.ts masks mobile even for an
    // employee viewing their OWN record via maskPii(), so there is no
    // existing precedent anywhere in this codebase for a role that sees it
    // in full. Match that established convention: last 4 digits only.
    // Non-null assertion is safe: emp.mobile is truthy here, and maskValue
    // only returns undefined for a null/undefined/empty input.
    ...(emp.mobile         ? { phone: maskValue(emp.mobile)! }        : {}),
    ...(desig?.payGrade    ? { grade: desig.payGrade }                : {}),
    ...(emp.station        ? { postingLocation: emp.station }         : {}),
    // HR-A deep-verify finding: confirmationDate is a real column already on
    // `emp` (no extra query), declared on the EmployeeDetail type, and used by
    // the frontend to render a "Service Confirmed" lifecycle event -- but was
    // never included here, so that event could never appear for anyone.
    ...(emp.confirmationDate ? { confirmationDate: emp.confirmationDate } : {}),
    ...(manager?.fullName  ? { reportingTo: manager.fullName }        : {}),
  };
}

export async function listEmployees(tenantId: string, limit: number, offset: number, employeeType?: string): Promise<{ data: Array<{ id: string; name: string; department: string; status: string }>; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, "employee", `list:${limit}:${offset}:${employeeType ?? "all"}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset, employeeType);
    const depts = await scopedRead((tx) => tx.select().from(hrmsDepartments).where(eq(hrmsDepartments.tenantId, tenantId)));
    const deptNameById = new Map(depts.map((d) => [d.id, d.name]));
    return {
      data: rows.map((r) => ({
        id: r.id,
        employeeNo: r.employeeNo,
        name: r.fullName,
        department: deptNameById.get(r.departmentId) ?? "—",
        employeeType: r.employeeType,
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
