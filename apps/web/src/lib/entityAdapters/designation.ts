import type { EntityOption } from "@/app/_components/ds";

type DesignationRow = { id: string; name: string; grade?: string };

function toOption(row: DesignationRow): EntityOption {
  return { id: row.id, label: row.name, sublabel: row.grade ? `Grade ${row.grade}` : undefined };
}

/**
 * EntityPicker adapters for designations (GAP-HR-PROMOTION-05 /
 * GAP-HR-SF-06). GET /v1/hrms/designations (employee/masters-routes.ts) has
 * no `q`/pagination param and returns the whole tenant's designation list
 * unconditionally -- designations are a small, bounded, per-tenant master
 * list (this mirrors lib/entityAdapters/payStructure.ts's identical
 * reasoning for the same shape of endpoint): fetch that same existing list
 * once and filter/match client-side, a legitimate implementation of the
 * generic {id,label,sublabel} search(q)/resolve(ids) contract EntityPicker
 * expects of any adapter. If designations ever grow past a single-page
 * list, this can move to real server-side search without EntityPicker or
 * its callers changing at all.
 */
async function fetchAll(signal?: AbortSignal): Promise<DesignationRow[]> {
  const res = await fetch("/api/proxy/v1/hrms/designations", { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: DesignationRow[] } | DesignationRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchDesignations(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  return filtered.map(toOption);
}

export async function resolveDesignations(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows.filter((r) => idSet.has(r.id)).map(toOption);
}
