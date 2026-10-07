import type { EntityOption } from "@/app/_components/ds";

type DivisionRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  officeType?: string | null;
};

function toOption(row: DivisionRow): EntityOption {
  const name = (row.name ?? "").trim();
  const code = (row.code ?? "").trim();
  return {
    id: row.id,
    label: name || code || row.id,
    sublabel: code && name ? code : undefined,
  };
}

function rowsOf(body: unknown): DivisionRow[] {
  if (Array.isArray(body)) return body as DivisionRow[];
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as DivisionRow[]) : [];
}

/**
 * EntityPicker adapters for the works division master (GAP-WORKS-REPORTS-01).
 *
 * Wraps the server-side typeahead GET /v1/works/masters/divisions/search
 * (works-service masters/routes.ts), which matches name OR code
 * (case-insensitive), active divisions only, and returns {id, name, code} —
 * so the reports filter can let a user pick a division by NAME and send its
 * real uuid as ?divisionId=, instead of free-typing a code that silently
 * returns an empty register. Real server-side search (not whole-list +
 * client filter) because divisions can grow and the endpoint already caps the
 * result. Returns [] on any non-ok response (the picker shows "No matches"
 * rather than throwing).
 */
export async function searchDivisions(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const qs = new URLSearchParams({ q: query.trim(), limit: "20" });
  const res = await fetch(`/api/proxy/v1/works/masters/divisions/search?${qs.toString()}`, { signal });
  if (!res.ok) return [];
  return rowsOf(await res.json()).map(toOption);
}

/**
 * Resolve seeded division ids to labels. The search endpoint has no ids=
 * filter, so this fetches the (bounded) active list once and filters —
 * sufficient for echoing a single selected division's name on the filter bar.
 * Fail-soft to [] so the picker falls back to the raw id until a name is known.
 */
export async function resolveDivisions(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const res = await fetch(`/api/proxy/v1/works/masters/divisions/search?limit=50`);
  if (!res.ok) return [];
  return rowsOf(await res.json())
    .filter((r) => idSet.has(r.id))
    .map(toOption);
}
