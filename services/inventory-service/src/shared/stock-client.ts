/**
 * Read-only client to stock-service for the item cross-reference
 * (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02). inventory-service and stock-service are
 * separate physical databases, so this is an internal service-to-service HTTP call, never a
 * JOIN. Same x-internal + x-service-secret + x-tenant-id path the GRN client uses; bounded
 * timeout; "unreachable" is a distinct error from "not found" and callers must not conflate them.
 */
const STOCK_URL = process.env.STOCK_SERVICE_URL ?? "http://127.0.0.1:3011";
const STOCK_TIMEOUT_MS = Number(process.env.STOCK_FETCH_TIMEOUT_MS ?? "5000");
const PAGE = 200;

/** Raised when stock-service cannot be reached or answers with a failure. */
export class StockUnavailableError extends Error {
  readonly code = "STOCK_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "StockUnavailableError";
  }
}

export type RemoteStockItem = { id: string; code: string; name: string; uom: string | null; isActive: boolean };
export type RemoteStockWarehouseBalance = { warehouseId: string; qty: number; rateMinor: string; valueMinor: string };
export type RemoteStockBalances = {
  itemId: string;
  totalQty: number;
  totalValueMinor: string;
  warehouses: RemoteStockWarehouseBalance[];
};

async function get(tenantId: string, path: string): Promise<Response> {
  try {
    return await fetch(`${STOCK_URL}${path}`, {
      headers: {
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(STOCK_TIMEOUT_MS),
    });
  } catch (err) {
    throw new StockUnavailableError(`stock-service unreachable: ${(err as Error).message}`);
  }
}

function asItem(r: unknown): RemoteStockItem | null {
  if (typeof r !== "object" || r === null) return null;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  const code = typeof o.code === "string" && o.code.trim() !== "" ? o.code : typeof o.itemCode === "string" ? o.itemCode : null;
  if (code === null) return null;
  return { id: o.id, code, name: o.name, uom: typeof o.uom === "string" ? o.uom : null, isActive: o.isActive !== false };
}

/** One stock item, or null when stock-service says 404. Throws StockUnavailableError otherwise. */
export async function fetchStockItem(tenantId: string, id: string): Promise<RemoteStockItem | null> {
  const res = await get(tenantId, `/v1/stock/items/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new StockUnavailableError(`stock-service item lookup failed: ${res.status}`);
  return asItem(await res.json());
}

/** One page of stock items (optionally text-filtered by stock-service). */
export async function searchStockItems(tenantId: string, q: string, limit: number): Promise<RemoteStockItem[]> {
  const qs = new URLSearchParams({ limit: String(Math.min(limit, PAGE)), offset: "0" });
  if (q.trim() !== "") qs.set("q", q.trim());
  const res = await get(tenantId, `/v1/stock/items?${qs.toString()}`);
  if (!res.ok) throw new StockUnavailableError(`stock-service item search failed: ${res.status}`);
  const body = (await res.json()) as { data?: unknown[] };
  return (body.data ?? []).map(asItem).filter((x): x is RemoteStockItem => x !== null);
}

/** Every stock item for the tenant, paged, bounded by `cap`. `truncated` says the cap was hit. */
export async function fetchAllStockItems(tenantId: string, cap = 5000): Promise<{ items: RemoteStockItem[]; truncated: boolean }> {
  const items: RemoteStockItem[] = [];
  for (let offset = 0; offset < cap; offset += PAGE) {
    const res = await get(tenantId, `/v1/stock/items?limit=${PAGE}&offset=${offset}`);
    if (!res.ok) throw new StockUnavailableError(`stock-service item list failed: ${res.status}`);
    const body = (await res.json()) as { data?: unknown[] };
    const rows = (body.data ?? []).map(asItem).filter((x): x is RemoteStockItem => x !== null);
    items.push(...rows);
    if ((body.data ?? []).length < PAGE) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/** Per-warehouse quantity/valuation of a stock item; null when stock-service says 404. */
export async function fetchStockBalances(tenantId: string, id: string): Promise<RemoteStockBalances | null> {
  const res = await get(tenantId, `/v1/stock/items/${encodeURIComponent(id)}/balances`);
  if (res.status === 404) return null;
  if (!res.ok) throw new StockUnavailableError(`stock-service balances lookup failed: ${res.status}`);
  return (await res.json()) as RemoteStockBalances;
}
