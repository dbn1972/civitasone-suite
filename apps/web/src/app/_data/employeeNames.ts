import { fetchJson } from "./apiClient";

/**
 * Server-side batch employee-name resolver (b3 payroll gap batch:
 * GAP-PAYROLL-ARREARS-01, BONUS-01, CORRECTIONS-02, REIMBURSEMENTS-01).
 *
 * The payroll registers (arrears, bonus, corrections, reimbursements) carry
 * only `employee_id`; payroll-service has no employee table of its own. This
 * reuses the hrms directory LIST route's existing `ids=` batch lookup (the
 * same one the EntityPicker `resolveEmployees` adapter uses) -- one request
 * per 50 ids (the route's cap), never one per row -- and returns only the
 * directory's non-PII id / employeeNo / name.
 *
 * Never throws: an id the directory doesn't return (deleted, out of the
 * caller's directory scope, or the lookup failed) is simply absent from the
 * map, and callers render `employeeDisplayLabel`'s "unknown" fallback.
 */
export type EmployeeName = { name: string; employeeNo: string | null };

const IDS_PER_REQUEST = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DirectoryRow = { id?: unknown; name?: unknown; fullName?: unknown; employeeNo?: unknown };

function toEntries(payload: unknown): Array<[string, EmployeeName]> | null {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return null;
  const out: Array<[string, EmployeeName]> = [];
  for (const raw of rows as DirectoryRow[]) {
    if (!raw || typeof raw.id !== "string") continue;
    const name = typeof raw.name === "string" ? raw.name : typeof raw.fullName === "string" ? raw.fullName : "";
    if (!name) continue;
    out.push([raw.id, { name, employeeNo: typeof raw.employeeNo === "string" && raw.employeeNo ? raw.employeeNo : null }]);
  }
  return out;
}

export async function resolveEmployeeNames(ids: Iterable<string>): Promise<Map<string, EmployeeName>> {
  const unique = [...new Set([...ids].filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  const result = new Map<string, EmployeeName>();
  if (unique.length === 0) return result;

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) chunks.push(unique.slice(i, i + IDS_PER_REQUEST));

  const pages = await Promise.all(
    chunks.map((chunk) =>
      fetchJson<unknown, Array<[string, EmployeeName]>>(
        `/api/v1/hrms/employees?ids=${chunk.map(encodeURIComponent).join(",")}&limit=${IDS_PER_REQUEST}`,
        [],
        { telemetryKey: "hr.employees.names", revalidateSeconds: 30, mapResponse: toEntries },
      ),
    ),
  );
  for (const page of pages) {
    if (!Array.isArray(page.data)) continue;
    for (const entry of page.data) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && entry[1]) result.set(entry[0], entry[1]);
    }
  }
  return result;
}

/**
 * "Asha Rao (EMP-0042)" for a resolved id; "<unknownLabel> · 1a2b3c4d" (the
 * id's first 8 characters, enough to tell two unknowns apart) otherwise.
 */
export function employeeDisplayLabel(names: Map<string, EmployeeName>, id: string | null | undefined, unknownLabel: string): string {
  if (!id) return "—";
  const entry = names.get(id);
  if (!entry) return `${unknownLabel} · ${id.slice(0, 8)}`;
  return entry.employeeNo ? `${entry.name} (${entry.employeeNo})` : entry.name;
}
