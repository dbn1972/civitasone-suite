import type { EntityOption } from "@/app/_components/ds";
import { failStrict } from "./strict";

// GAP-HR-EMPLOYEES-DETAIL-EDIT-05: `status` was always present on the real
// GET /v1/hrms/employees row (services/hrms-service's queries.listEmployees
// returns id/employeeNo/name/department/employeeType/status) but unused by
// this adapter, so a caller had no way to filter by it. Duplicated here
// (not imported) for the same reason EditEmployeeForm.tsx's SENSITIVE_FIELDS
// comment gives: hrms-service's employee/status.ts is a separate service,
// across the service boundary this web app can't import across.
type EmployeeRow = { id: string; employeeNo?: string; name: string; department?: string; designation?: string; status?: string };

/**
 * GAP-HR-EMPLOYEES-NEW-04: statuses an employee has left the organisation for
 * good. Mirrors hrms-service's employee/status.ts EXITED_STATUSES (duplicated,
 * not imported -- cross-service boundary; same reason as the note above).
 * Pass as `excludeStatuses` wherever the picked person must still be serving
 * (a reporting manager): on_leave / suspended are temporary and stay pickable.
 */
export const MANAGER_INELIGIBLE_STATUSES = ["terminated", "separated", "retired"] as const;

function toOption(row: EmployeeRow): EntityOption {
  return {
    id: row.id,
    label: row.employeeNo ? `${row.name} (${row.employeeNo})` : row.name,
    // GAP-HR-EMPLOYEES-NEW-04: a name alone cannot tell two "R. Sharma"s apart
    // when choosing a reporting manager; the API already returns each person's
    // designation, so it leads the second line, ahead of the department.
    sublabel: [row.designation, row.department].filter(Boolean).join(" · ") || undefined,
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
 * purely-additive filter. It is sent to the server as
 * `?excludeStatuses=a,b,c` (GET /v1/hrms/employees applies it in the query, so
 * the 20-row page is never spent on people who cannot be chosen) AND applied
 * to the returned rows here as a safety net for a backend that predates the
 * param. Every existing caller that doesn't pass `opts` keeps today's
 * behavior unchanged (same URL, no filtering).
 */
export async function searchEmployees(
  query: string,
  signal: AbortSignal,
  opts?: { excludeStatuses?: readonly string[]; onForbidden?: () => void; strict?: boolean },
): Promise<EntityOption[]> {
  const exclude = opts?.excludeStatuses && opts.excludeStatuses.length > 0
    ? `&excludeStatuses=${opts.excludeStatuses.map(encodeURIComponent).join(",")}`
    : "";
  const res = await fetch(`/api/proxy/v1/hrms/employees?q=${encodeURIComponent(query)}&limit=20${exclude}`, { signal });
  // GAP-PAYROLL-FNF-05 review: GET /v1/hrms/employees is DIRECTORY_ROLES-gated,
  // so e.g. a payroll_admin/finance_officer-only user gets a 403. Callers that
  // pass `onForbidden` can say so explicitly instead of showing a silent
  // "no results"; behavior for every other caller is unchanged.
  if (res.status === 403) opts?.onForbidden?.();
  failStrict(res, opts);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: EmployeeRow[] } | EmployeeRow[];
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  const filtered = opts?.excludeStatuses
    ? rows.filter((r) => !r.status || !opts.excludeStatuses!.includes(r.status))
    : rows;
  return filtered.map(toOption);
}

/**
 * Pure payload -> options mapper (array or `{ data }` envelope). Server-safe: it does no I/O,
 * so a Server Component can pair it with fetchJson() instead of calling resolveEmployees(),
 * whose relative `/api/proxy/...` fetch only works in the browser.
 */
export function mapEmployeeOptions(payload: unknown): EntityOption[] | null {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return null;
  return (rows as EmployeeRow[]).map(toOption);
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
