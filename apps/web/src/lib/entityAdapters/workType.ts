import type { EntityOption } from "@/app/_components/ds";

type WorkTypeRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  active?: boolean | null;
};

function toOption(row: WorkTypeRow): EntityOption {
  const name = (row.name ?? "").trim();
  const code = (row.code ?? "").trim();
  return {
    id: row.id,
    label: name || code || row.id,
    sublabel: code && name ? code : undefined,
  };
}

/**
 * EntityPicker adapter for the works "work type" master
 * (GAP-WORKS-PROPOSALS-NEW-01). Wraps the existing
 * GET /v1/works/masters/work-types read (the same endpoint the masters page
 * uses — no new backend route, same role/tenant scoping) in the shared
 * search(q)/resolve(ids) contract, so a clerk picks a work type BY NAME
 * instead of hand-copying a UUID from a table that only shows the first 8
 * characters of the id. Returns [] on any non-ok response (the picker then
 * shows an honest "No matches" / error, never a silent empty free-text box).
 */
async function fetchAll(signal?: AbortSignal): Promise<WorkTypeRow[]> {
  const res = await fetch("/api/proxy/v1/works/masters/work-types?pageSize=200", { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: WorkTypeRow[] } | WorkTypeRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchWorkTypes(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const active = rows.filter((r) => r.active !== false);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? active.filter(
        (r) => (r.name ?? "").toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q),
      )
    : active;
  return filtered.map(toOption);
}

export async function resolveWorkTypes(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows.filter((r) => idSet.has(r.id)).map(toOption);
}
