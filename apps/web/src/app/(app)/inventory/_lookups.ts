/**
 * Server-side id -> display-name lookups for the inventory registers
 * (GAP-INVENTORY-BINS-02, GOODS-RETURNS-02, ISSUES-03, CYCLE-COUNTS-DETAIL-03,
 * LIST-03). The registers used to print 8-char UUID fragments because the list
 * endpoints return ids only. Names are resolved through the inventory-service
 * HTTP API (never a join across services) and are best-effort: a failed or
 * capped lookup leaves the name unset and the UI falls back (see _labels.ts).
 */
import { fetchJson } from "@/app/_data/apiClient";

/** The inventory-service list endpoints cap a page at 200 rows. */
export const LOOKUP_LIMIT = 200;
/** Max single-item fetches for ids missing from the first list page. */
const MISSING_ITEM_FETCH_CAP = 25;

export type ItemName = { name: string; sku: string | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function rowsOf(payload: unknown): Record<string, unknown>[] {
  return isRecord(payload) && Array.isArray(payload.data) ? payload.data.filter(isRecord) : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

async function loadNamed(path: string, telemetryKey: string): Promise<Map<string, string>> {
  const res = await fetchJson<unknown, Map<string, string>>(path, new Map(), {
    revalidateSeconds: 60,
    telemetryKey,
    mapResponse: (payload) => {
      const m = new Map<string, string>();
      for (const r of rowsOf(payload)) {
        const id = str(r.id);
        const name = str(r.name);
        if (id && name) m.set(id, name);
      }
      return m;
    },
  });
  return res.data;
}

export function getStoreNames(): Promise<Map<string, string>> {
  return loadNamed(`/api/v1/inventory/stores?limit=${LOOKUP_LIMIT}`, "inventory.lookup.stores");
}

export function getWarehouseNames(): Promise<Map<string, string>> {
  return loadNamed(`/api/v1/inventory/warehouses?limit=${LOOKUP_LIMIT}`, "inventory.lookup.warehouses");
}

/**
 * Supplier (vendor) names from procurement-service, for the receipts register
 * (GAP-INVENTORY-RECEIPTS-03). Best-effort: an inventory role that cannot read
 * vendors, or an unreachable service, yields an empty map and the column shows "—".
 */
export function getSupplierNames(): Promise<Map<string, string>> {
  return loadNamed(`/api/v1/procurement/vendors?limit=${LOOKUP_LIMIT}`, "inventory.lookup.suppliers");
}

/**
 * Item names for the ids a page is about to show: the first list page, then a
 * bounded number of single-item reads for ids that page did not contain.
 */
export async function getItemNames(wantedIds: Iterable<string> = []): Promise<Map<string, ItemName>> {
  const list = await fetchJson<unknown, Map<string, ItemName>>(
    `/api/v1/inventory/items?limit=${LOOKUP_LIMIT}`,
    new Map(),
    {
      revalidateSeconds: 60,
      telemetryKey: "inventory.lookup.items",
      mapResponse: (payload) => {
        const m = new Map<string, ItemName>();
        for (const r of rowsOf(payload)) {
          const id = str(r.id);
          const name = str(r.name);
          if (id && name) m.set(id, { name, sku: str(r.sku) });
        }
        return m;
      },
    },
  );
  const names = list.data;
  const missing = [...new Set(wantedIds)].filter((id) => !names.has(id)).slice(0, MISSING_ITEM_FETCH_CAP);
  const singles = await Promise.all(
    missing.map((id) =>
      fetchJson<unknown, ItemName | null>(`/api/v1/inventory/items/${encodeURIComponent(id)}`, null, {
        revalidateSeconds: 60,
        telemetryKey: "inventory.lookup.item",
        mapResponse: (payload) => {
          if (!isRecord(payload)) return null;
          const name = str(payload.name);
          return name ? { name, sku: str(payload.sku) } : null;
        },
      }).then((r) => [id, r.data] as const),
    ),
  );
  for (const [id, v] of singles) if (v) names.set(id, v);
  return names;
}
