import type { EntityOption } from "@/app/_components/ds";

type IdentityUserRow = { id: string; name: string; designation?: string };

function toOption(row: IdentityUserRow): EntityOption {
  return { id: row.id, label: row.name, sublabel: row.designation };
}

/**
 * EntityPicker adapters for identity-service users (GAP-HR-PROMOTION-05's
 * "initiating officer" / "forward to" pickers). Same client-side-filter
 * shape as lib/entityAdapters/payStructure.ts and ./designation.ts: this
 * calls the exact same `/api/proxy/v1/identity/users?limit=200` request
 * PromoteWithApproval.tsx already made directly (no new backend route, no
 * change to role/tenant scoping -- see that route's own access rules,
 * unchanged here), just wrapped in the shared search(q)/resolve(ids)
 * contract so the wizard gets a searchable picker instead of a plain
 * <select> with a silent raw-ID fallback on fetch failure.
 */
async function fetchAll(signal?: AbortSignal): Promise<IdentityUserRow[]> {
  const res = await fetch("/api/proxy/v1/identity/users?limit=200", { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: IdentityUserRow[] } | IdentityUserRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchIdentityUsers(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.designation ?? "").toLowerCase().includes(q))
    : rows;
  return filtered.map(toOption);
}

export async function resolveIdentityUsers(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows.filter((r) => idSet.has(r.id)).map(toOption);
}
