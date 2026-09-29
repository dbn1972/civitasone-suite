import type { EntityOption } from "@/app/_components/ds";

type EmployeeRow = { id: string; employeeNo?: string; name: string; department?: string };

function toOption(row: EmployeeRow): EntityOption {
  return {
    id: row.id,
    label: row.employeeNo ? `${row.name} (${row.employeeNo})` : row.name,
    sublabel: row.department,
  };
}

/**
 * EntityPicker search(q) adapter for employees (GAP-HR-SF-06) -- the "pick
 * an employee" case the SF-06 catalog entry names first (EntityPicker /
 * EmployeePicker / StaffPicker).
 *
 * Reuses the existing GET /v1/hrms/employees route (already
 * DIRECTORY_ROLES-gated, already returning only id/employeeNo/name/
 * department/employeeType/status -- no PII) with its new optional `q`
 * filter, rather than standing up a bespoke endpoint. See services/
 * hrms-service/src/modules/employee/routes.ts's DIRECTORY_ROLES comment:
 * the role scope for "who may search this list" was already decided for
 * the employee directory, and this adds neither a new role nor a new
 * response field -- it does not add work-email/extension exposure either
 * (that remains GAP-HR-DIRECTORY-04's own, separate, not-yet-implemented
 * fix step), so this stays strictly within the already-safe shape.
 */
export async function searchEmployees(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const res = await fetch(`/api/proxy/v1/hrms/employees?q=${encodeURIComponent(query)}&limit=20`, { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: EmployeeRow[] } | EmployeeRow[];
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  return rows.map(toOption);
}

/**
 * EntityPicker resolve(ids) adapter for employees -- pre-populates a
 * picker's label for an id an edit form already has (e.g. an existing
 * manager assignment) instead of leaving it blank until the user retypes.
 */
export async function resolveEmployees(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`/api/proxy/v1/hrms/employees?ids=${ids.map(encodeURIComponent).join(",")}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: EmployeeRow[] } | EmployeeRow[];
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  return rows.map(toOption);
}
