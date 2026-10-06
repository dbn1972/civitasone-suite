import type { EntityOption } from "@/app/_components/ds";

type RoleRow = { id?: unknown; name?: unknown; description?: unknown };

/**
 * GAP-POLICY-BINDINGS-02: EntityPicker adapters for policy-service roles. Calls
 * the same `/api/proxy/policy/roles` endpoint /tenant-admin/roles already uses
 * (no new backend route, no change to scoping). Labels with the role NAME so an
 * admin never has to recognise a UUID; the id is still what gets submitted.
 */
export function roleToOption(row: RoleRow): EntityOption | null {
  if (typeof row.id !== "string") return null;
  const name = typeof row.name === "string" && row.name ? row.name : row.id;
  const sublabel = typeof row.description === "string" && row.description ? row.description : undefined;
  return { id: row.id, label: name, sublabel };
}

async function fetchAll(signal?: AbortSignal): Promise<RoleRow[]> {
  const res = await fetch("/api/proxy/policy/roles", signal ? { signal } : {});
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: RoleRow[] } | RoleRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchPolicyRoles(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const opts = rows.flatMap((r) => {
    const o = roleToOption(r);
    return o ? [o] : [];
  });
  return q ? opts.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q)) : opts;
}

export async function resolvePolicyRoles(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows.flatMap((r) => {
    const o = roleToOption(r);
    return o && idSet.has(o.id) ? [o] : [];
  });
}
