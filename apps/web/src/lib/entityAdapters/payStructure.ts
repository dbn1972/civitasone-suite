import type { EntityOption } from "@/app/_components/ds";

type PayStructureRow = { id: string; name?: string; code?: string };

function toOption(row: PayStructureRow): EntityOption {
  const label = row.name ?? row.code ?? row.id;
  return { id: row.id, label, sublabel: row.name && row.code ? row.code : undefined };
}

/**
 * EntityPicker adapters for pay structures (GAP-HR-SF-06 /
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-04's "Pay Structure starts blank on every
 * visit" fix).
 *
 * Pay structures are a small, bounded, per-tenant list -- the pre-existing
 * EditEmployeeForm.tsx already fetched the *entire* list in one call
 * (`/api/proxy/v1/payroll/structures?limit=200`) to populate a plain
 * `<select>`, and payroll-service's structures route has no search param.
 * Rather than adding server-side search to a different service for this
 * PR, both adapters fetch that same existing list once and filter/match
 * client-side -- a legitimate, purely client-side implementation of the
 * same generic {id,label,sublabel} search(q)/resolve(ids) contract
 * EntityPicker expects of any adapter. If pay structures ever grow past a
 * single-page list, this can move to real server-side search without
 * EntityPicker or its callers changing at all.
 */
async function fetchAll(signal?: AbortSignal): Promise<PayStructureRow[]> {
  const res = await fetch("/api/proxy/v1/payroll/structures?limit=200", { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: PayStructureRow[] } | PayStructureRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchPayStructures(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => (r.name ?? "").toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q))
    : rows;
  return filtered.map(toOption);
}

export async function resolvePayStructures(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows.filter((r) => idSet.has(r.id)).map(toOption);
}
