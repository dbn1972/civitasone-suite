/**
 * Generic batch id -> display-name resolution for list/GET-many endpoints
 * (GAP-HR-SF-17). Generalizes the batchEmployees/batchDepartments/
 * batchDesignations pattern already used by lifecycle/m7-list-routes.ts so
 * other route files can adopt the same shape without redefining it locally.
 *
 * Rule-4 compliant by construction: this file owns no schema and runs no
 * query of its own. Every lookup below delegates to the OWNING module's
 * own repo (its in-process domain interface) — never a raw cross-module
 * schema import or join. A new lookup belongs here once the owning
 * module's repo exposes a `(tenantId, ids) => Promise<{id, name}[]>`-shaped
 * export (add one there first, mirroring employee/repo.ts's
 * findDepartmentsByIds/findDesignationsByIds, then wire it through
 * `batchNames` below) — never by importing that module's schema.ts.
 *
 * NOTE: lifecycle/m7-list-routes.ts's own local batchEmployees/
 * batchDepartments/batchDesignations are intentionally left as-is rather
 * than migrated to call this module — that file has unrelated, already
 * in-flight changes tonight (GAP-HR-SF-16), and migrating it here too would
 * create needless merge risk for an unrelated PR. New call sites should use
 * this module directly; m7-list-routes.ts's own copies are a candidate for
 * a later, separate dedupe pass once SF-16 lands.
 */
import * as employeeRepo from "../modules/employee/repo.js";

export interface EmployeeSummary {
  id: string;
  fullName: string;
  departmentId: string;
  designationId: string;
  // GAP-HR-ADVANCES-01 / GAP-HR-LOANS-01: consumers that render "Name
  // (EmpNo)" (the established convention elsewhere in this codebase, e.g.
  // RequestAdvanceForm.tsx's own employee picker) need the employee number
  // alongside the name. Additive: employeeRepo.findManyByIds now selects it
  // too (see that function's own comment); every existing consumer that
  // destructures only {fullName, departmentId, designationId} is unaffected.
  employeeNo: string;
}

function uniqIds(ids: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * The generic building block: given a tenant-scoped `(tenantId, ids) =>
 * Promise<{id, name}[]>` fetcher (an owning module's own repo export) and a
 * list of possibly-sparse/duplicate ids, returns a Map for O(1) per-row
 * lookup at the call site (`map.get(id) ?? "—"`).
 */
export async function batchNames(
  fetchByIds: (tenantId: string, ids: string[]) => Promise<Array<{ id: string; name: string }>>,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const clean = uniqIds(ids);
  if (clean.length === 0) return new Map();
  const rows = await fetchByIds(tenantId, clean);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Batch-resolve employee ids to {id, fullName, employeeNo, departmentId, designationId}. Tenant-scoped. */
export async function batchEmployees(
  tenantId: string,
  employeeIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, EmployeeSummary>> {
  const ids = uniqIds(employeeIds);
  if (ids.length === 0) return new Map();
  const rows = await employeeRepo.findManyByIds(tenantId, ids);
  return new Map(rows.map((e) => [e.id, e]));
}

/** Batch-resolve department ids to names. Tenant-scoped. */
export function batchDepartments(
  tenantId: string,
  deptIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  return batchNames(employeeRepo.findDepartmentsByIds, tenantId, deptIds);
}

/** Batch-resolve designation ids to names. Tenant-scoped. */
export function batchDesignations(
  tenantId: string,
  desigIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  return batchNames(employeeRepo.findDesignationsByIds, tenantId, desigIds);
}
