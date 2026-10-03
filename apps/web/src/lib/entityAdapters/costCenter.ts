import type { EntityOption } from "@/app/_components/ds";

type CostCenterRow = { id: string; code?: string; name?: string };

function toOption(row: CostCenterRow): EntityOption {
  const label = row.name ?? row.code ?? row.id;
  return { id: row.id, label, sublabel: row.name && row.code ? row.code : undefined };
}

/**
 * EntityPicker adapters for the finance cost-centre master (GAP-HR-EMPLOYEES-NEW-01:
 * the wizard's cost centre used to be free text that never reached the record;
 * it is now the picked cost centre's id, stored as hrms_employees.cost_center_id).
 *
 * The master is a small bounded per-tenant list and GET /v1/finance/cost-centers
 * has no search param, so (like the pay-structure adapter) both functions read
 * that one list and filter client-side.
 */
async function fetchAll(signal?: AbortSignal): Promise<CostCenterRow[]> {
  const res = await fetch("/api/proxy/v1/finance/cost-centers", signal ? { signal } : undefined);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: CostCenterRow[] } | CostCenterRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchCostCenters(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => (r.name ?? "").toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q))
    : rows;
  return filtered.slice(0, 50).map(toOption);
}

export async function resolveCostCenters(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows.filter((r) => idSet.has(r.id)).map(toOption);
}
