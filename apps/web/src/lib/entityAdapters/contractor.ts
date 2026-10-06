import type { EntityOption } from "@/app/_components/ds";

type ContractorRow = {
  id: string;
  name?: string | null;
  registrationNo?: string | null;
};

function toOption(row: ContractorRow): EntityOption {
  const name = (row.name ?? "").trim();
  const reg = (row.registrationNo ?? "").trim();
  return {
    id: row.id,
    label: name || reg || row.id,
    sublabel: name && reg ? `Reg. ${reg}` : undefined,
  };
}

/**
 * EntityPicker adapter for works contractors (GAP-WORKS-TENDERS-DETAIL-01).
 * Wraps the SAME GET /v1/works/contractors read the contractor register page
 * uses (contractors/page.tsx) — no new backend route, same role/tenant
 * scoping — in the shared search(q)/resolve(ids) contract so the Add
 * Quotation / Create Award forms can let a user pick a registered contractor
 * (returning {id, label}) instead of free-typing a name that may be a spelling
 * variant of an existing firm. Returns [] on any non-ok response (the picker
 * then shows "No matches" rather than throwing).
 */
async function fetchAll(signal?: AbortSignal): Promise<ContractorRow[]> {
  const res = await fetch("/api/proxy/v1/works/contractors?pageSize=200", signal ? { signal } : undefined);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: ContractorRow[] } | ContractorRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchContractors(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          (r.name ?? "").toLowerCase().includes(q) ||
          (r.registrationNo ?? "").toLowerCase().includes(q),
      )
    : rows;
  return filtered.map(toOption);
}

export async function resolveContractors(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows.filter((r) => idSet.has(r.id)).map(toOption);
}
