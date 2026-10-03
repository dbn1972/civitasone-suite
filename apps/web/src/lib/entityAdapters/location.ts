import type { EntityOption } from "@/app/_components/ds";

type LocationRow = { id: string; name: string; type?: string; city?: string; status?: string };

function toOption(row: LocationRow): EntityOption {
  return { id: row.id, label: row.name, sublabel: [row.type, row.city].filter(Boolean).join(" · ") || undefined };
}

/**
 * EntityPicker adapters over the location master (GAP-HR-LOCATIONS-03: the Add
 * Employee wizard's Work Location was free text mapped to `station`, so
 * employees were never tied to the master the Locations screen promises).
 *
 * GET /v1/locations has no search param, so both functions read the one list
 * (bounded by the service) and filter client-side, like the pay-structure and
 * cost-centre adapters. Archived locations are never offered: an archived
 * location "cannot be selected for new records".
 */
async function fetchAll(signal?: AbortSignal): Promise<LocationRow[]> {
  const res = await fetch("/api/proxy/v1/locations?limit=500", signal ? { signal } : undefined);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: LocationRow[] } | LocationRow[];
  return (Array.isArray(body) ? body : (body.data ?? [])).filter((r) => r.status !== "archived");
}

export async function searchLocations(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.city ?? "").toLowerCase().includes(q)) : rows;
  return filtered.slice(0, 50).map(toOption);
}

export async function resolveLocations(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const set = new Set(ids);
  // resolve must find a location even if it was archived after being picked
  const res = await fetch("/api/proxy/v1/locations?limit=500");
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: LocationRow[] } | LocationRow[];
  return (Array.isArray(body) ? body : (body.data ?? [])).filter((r) => set.has(r.id)).map(toOption);
}
