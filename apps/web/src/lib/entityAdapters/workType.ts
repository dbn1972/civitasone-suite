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
 * characters of the id. search() throws on a non-ok response so the picker shows its error text,
 * never a misleading "No matches"; resolve() stays fail-soft.
 */
async function fetchAll(signal?: AbortSignal, strict = false): Promise<WorkTypeRow[]> {
  const res = await fetch("/api/proxy/v1/works/masters/work-types?pageSize=200", { signal });
  // GAP-WORKS-PROPOSALS-NEW-01: a failing SEARCH must throw so the picker shows
  // its error state, never "No matches" (which reads as "no such work type").
  if (!res.ok) {
    if (strict) throw new Error("work-types fetch failed");
    return [];
  }
  const body = (await res.json()) as { data?: WorkTypeRow[] } | WorkTypeRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchWorkTypes(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal, true);
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
