import type { EntityOption } from "@/app/_components/ds";

type DepartmentRow = {
  id: string;
  name?: string | null;
  code?: string | null;
};

function toOption(row: DepartmentRow): EntityOption | null {
  if (!row.id) return null;
  const name = (row.name ?? "").trim();
  const code = (row.code ?? "").trim();
  return {
    id: row.id,
    label: name || code || row.id,
    sublabel: name && code ? code : undefined,
  };
}

function rowsOf(body: unknown): DepartmentRow[] {
  if (Array.isArray(body)) return body as DepartmentRow[];
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as DepartmentRow[]) : [];
}

/**
 * EntityPicker adapters for the org department master (GAP-PROCUREMENT-PLANNING-NEW-02).
 *
 * Backed by hrms-service's existing GET /v1/hrms/departments (the canonical
 * org department list, employee/masters-routes.ts) — no new backend route.
 * That endpoint has no q/pagination param and returns the whole tenant's
 * (bounded) department list, so this fetches it once and filters/matches
 * client-side — the same reasoning as lib/entityAdapters/designation.ts for
 * the identically-shaped hrms masters endpoint.
 *
 * The procurement plan body carries `department` as a canonical NAME string
 * (createPlanBody.department), so the New-Plan form sends the SELECTED option's
 * label (its canonical department name) — two plans for the same department
 * therefore always carry an identical string, which is what the ministry-level
 * aggregation the plan exists for requires (a free-text box let "PWD" / "P.W.D"
 * / "Public Works Dept" all file as different departments). Returns [] on any
 * non-ok response (the picker shows "No matches" rather than throwing).
 */
async function fetchAll(signal?: AbortSignal): Promise<DepartmentRow[]> {
  const res = await fetch("/api/proxy/v1/hrms/departments", signal ? { signal } : undefined);
  if (!res.ok) return [];
  return rowsOf(await res.json());
}

export async function searchDepartments(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) => (r.name ?? "").toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q),
      )
    : rows;
  return filtered.map(toOption).filter((o): o is EntityOption => o !== null);
}

export async function resolveDepartments(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows
    .filter((r) => idSet.has(r.id))
    .map(toOption)
    .filter((o): o is EntityOption => o !== null);
}
