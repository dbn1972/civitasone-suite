import type { EntityOption } from "@/app/_components/ds";
import { failStrict, type StrictOpt } from "./strict";

type WarehouseRow = { id: string; name?: string | null; code?: string | null; status?: string | null };

function toOption(row: WarehouseRow): EntityOption | null {
  const name = (row.name ?? "").trim();
  const code = (row.code ?? "").trim();
  if (!name && !code) return null;
  return { id: row.id, label: name || code, sublabel: name && code ? code : undefined };
}

function rowsOf(body: unknown): WarehouseRow[] {
  if (Array.isArray(body)) return body as WarehouseRow[];
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as WarehouseRow[]) : [];
}

/**
 * EntityPicker adapters over inventory-service warehouses (SF-06: the stock
 * ledger's "Warehouse ID (optional)" was a raw UUID box). GET
 * /v1/inventory/warehouses is tenant-scoped by the API and has no search
 * param, so this reads the bounded list and filters name/code client-side.
 * `search` honours `{ strict: true }` (throw on non-ok instead of []).
 */
async function fetchAll(signal?: AbortSignal, opts?: StrictOpt): Promise<WarehouseRow[]> {
  const res = await fetch("/api/proxy/v1/inventory/warehouses?limit=200", signal ? { signal } : undefined);
  failStrict(res, opts);
  if (!res.ok) return [];
  return rowsOf(await res.json());
}

export async function searchWarehouses(query: string, signal: AbortSignal, opts?: StrictOpt): Promise<EntityOption[]> {
  const rows = await fetchAll(signal, opts);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => (r.name ?? "").toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q))
    : rows;
  return filtered.map(toOption).filter((o): o is EntityOption => o !== null);
}

export async function resolveWarehouses(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const set = new Set(ids);
  const rows = await fetchAll();
  return rows
    .filter((r) => set.has(r.id))
    .map(toOption)
    .filter((o): o is EntityOption => o !== null);
}
