import type { EntityOption } from "@/app/_components/ds";

// GAP-HR-EMPLOYEES-DETAIL-EDIT-05: `status` was always present on the real
// GET /v1/hrms/employees row (services/hrms-service's queries.listEmployees
// returns id/employeeNo/name/department/employeeType/status) but unused by
// this adapter, so a caller had no way to filter by it. Duplicated here
// (not imported) for the same reason EditEmployeeForm.tsx's SENSITIVE_FIELDS
// comment gives: hrms-service's employee/status.ts is a separate service,
// across the service boundary this web app can't import across.
type EmployeeRow = { id: string; employeeNo?: string; name: string; department?: string; status?: string };

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
 *
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-05: `opts.excludeStatuses` is an optional,
 * purely-additive client-side filter applied to the rows this endpoint
 * already returns -- it does NOT add a new backend query param (the
 * underlying GET /v1/hrms/employees has no status filter either, and this
 * directory endpoint has many unrelated callers across the app, so widening
 * its own query surface for one caller's business rule was deliberately
 * avoided; see EditEmployeeForm.tsx's own comment on this same gap for why).
 * Every existing caller that doesn't pass `opts` keeps today's behavior
 * unchanged.
 */
export async function searchEmployees(
  query: string,
  signal: AbortSignal,
  opts?: { excludeStatuses?: readonly string[]; onForbidden?: () => void },
): Promise<EntityOption[]> {
  const res = await fetch(`/api/proxy/v1/hrms/employees?q=${encodeURIComponent(query)}&limit=20`, { signal });
  // GAP-PAYROLL-FNF-05 review: GET /v1/hrms/employees is DIRECTORY_ROLES-gated,
  // so e.g. a payroll_admin/finance_officer-only user gets a 403. Callers that
  // pass `onForbidden` can say so explicitly instead of showing a silent
  // "no results"; behavior for every other caller is unchanged.
  if (res.status === 403) opts?.onForbidden?.();
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: EmployeeRow[] } | EmployeeRow[];
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  const filtered = opts?.excludeStatuses
    ? rows.filter((r) => !r.status || !opts.excludeStatuses!.includes(r.status))
    : rows;
  return filtered.map(toOption);
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
