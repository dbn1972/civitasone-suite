import type { EntityOption } from "@/app/_components/ds";

/**
 * EntityPicker adapters for the PAYROLL employee lookup
 * (GET /v1/payroll/employee-lookup, GAP-PAYROLL-LOANS-01).
 *
 * The HRMS employee directory is DIRECTORY_ROLES-gated, so a payroll_admin /
 * payroll_officer / finance_officer who is not also an HR role got an empty
 * picker (403 swallowed as "no results") on exactly the screens they operate.
 * The payroll lookup is open to the payroll roles and returns the same
 * id / employeeNo / name / department shape -- nothing more (no PAN, bank or
 * contact data). Use these on payroll screens; the HRMS adapters in
 * ./employee.ts stay for HR screens.
 */
type LookupRow = { id: string; employeeNo?: string | null; name: string; department?: string };

function toOption(row: LookupRow): EntityOption {
  return {
    id: row.id,
    label: row.employeeNo ? `${row.name} (${row.employeeNo})` : row.name,
    sublabel: row.department,
  };
}

async function rowsOf(res: Response): Promise<LookupRow[]> {
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: LookupRow[] } | LookupRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchPayrollEmployees(
  query: string,
  signal: AbortSignal,
  opts?: { onForbidden?: () => void },
): Promise<EntityOption[]> {
  const res = await fetch(`/api/proxy/v1/payroll/employee-lookup?q=${encodeURIComponent(query)}&limit=20`, { signal });
  if (res.status === 403) opts?.onForbidden?.();
  return (await rowsOf(res)).map(toOption);
}

export async function resolvePayrollEmployees(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`/api/proxy/v1/payroll/employee-lookup?ids=${ids.map(encodeURIComponent).join(",")}`);
  return (await rowsOf(res)).map(toOption);
}
