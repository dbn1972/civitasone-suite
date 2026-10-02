/**
 * inventory route-group server loaders. These call the inventory-service
 * endpoints through the gateway (/api/v1/inventory/*) using the shared,
 * cookie-aware fetchJson helper. They run on the server only.
 *
 * Kept inside the inventory route group (rather than the global _data/loaders)
 * so the module stays self-contained.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { SUBSTITUTES_ITEM_CAP } from "./substitutesCoverage";
import { getItemNames, getStoreNames, getWarehouseNames } from "./_lookups";

import { INVENTORY_LEDGER_LIMIT, INVENTORY_LIST_LIMIT } from "./_limits";
export { INVENTORY_LEDGER_LIMIT, INVENTORY_LIST_LIMIT };

export type InventoryItemRow = {
  id: string;
  name: string;
  sku: string | null;
  status: string;
  category: string | null;
  uom: string | null;
  itemType: string;
  reorderLevel: number;
  reorderQty: number;
  unitCostMinor: string;
};

/** Optional display names resolved server-side from ids (see _lookups.ts). */
type WithItemName = { itemName?: string | null; itemSku?: string | null };

export type InventoryLedgerRow = {
  id: string;
  movementId: string;
  movementType: string;
  itemId: string;
  storeId: string;
  qtyIn: number;
  qtyOut: number;
  balanceQty: number;
  rateMinor: string;
  valueMinor: string;
  reasonCode: string | null;
  postingDate: string;
} & WithItemName & { storeName?: string | null };

export type InventoryLowStockRow = {
  itemId: string;
  storeId: string;
  name: string;
  sku: string | null;
  onHandQty: number;
  reorderLevel: number;
  suggestedReorderQty: number;
};

export type InventoryBinRow = {
  id: string;
  storeId: string;
  code: string;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  capacity: number | null;
  isActive: boolean;
  createdAt: string;
  storeName?: string | null;
};

export type InventoryReservationRow = {
  id: string;
  itemId: string;
  storeId: string;
  qty: number;
  refType: string;
  refId: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
};

export type InventoryGoodsReturnRow = {
  id: string;
  originalIssueId: string;
  itemId: string;
  storeId: string;
  qty: number;
  reason: string;
  qcStatus: string;
  disposition: string;
  qcNotes: string | null;
  createdAt: string;
} & WithItemName & { storeName?: string | null };

export type InventorySubstituteRow = {
  id: string;
  itemId: string;
  substituteId: string;
  priority: number;
  conversionFactor: string;
  createdAt: string;
};

export type InventoryCycleCountRow = {
  id: string;
  itemId: string;
  warehouseId: string;
  systemQty: number;
  physicalQty: number;
  variance: number;
  absVariance: number;
  status: string;
  reasonCode: string;
  countedAt: string;
} & WithItemName & { warehouseName?: string | null };

export type InventoryForecastResult = {
  available: boolean;
  itemId: string;
  dailyForecast: number[];
  totalDemand: number;
  confidence: number;
};

type Envelope<T> = { data?: T[] } | null | undefined;

function listOf<T>(payload: Envelope<T>): T[] {
  return Array.isArray(payload?.data) ? (payload!.data as T[]) : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Adds resolved names to a register's rows. Lookups are best-effort: any
 * failure returns the rows untouched (the UI then shows its id/"—" fallback)
 * and a failed primary fetch is passed through unchanged.
 */
async function withNames<T>(
  res: LoaderResult<T[]>,
  enrich: (rows: T[]) => Promise<T[]>,
): Promise<LoaderResult<T[]>> {
  if (res.source === "error" || res.data.length === 0) return res;
  try {
    return { ...res, data: await enrich(res.data) };
  } catch {
    return res;
  }
}

export function getInventoryItems(): Promise<LoaderResult<InventoryItemRow[]>> {
  // The service default page is 50 -- without an explicit limit the register
  // silently stopped at 50 items (GAP-INVENTORY-ITEMS-04).
  return fetchJson<Envelope<InventoryItemRow>, InventoryItemRow[]>(`/api/v1/inventory/items?limit=${INVENTORY_LIST_LIMIT}`, [], {
    revalidateSeconds: 60,
    telemetryKey: "inventory.items",
    mapResponse: listOf,
  });
}

export type InventoryMovementType = "receipt" | "issue" | "transfer" | "adjustment";

/**
 * Stock ledger, newest first. `movementType` is filtered by the service so a
 * single-type register (Issues) is not a client-side slice of the newest N
 * mixed rows (GAP-INVENTORY-ISSUES-02).
 */
export async function getInventoryLedger(
  opts: { movementType?: InventoryMovementType } = {},
): Promise<LoaderResult<InventoryLedgerRow[]>> {
  const qs = new URLSearchParams({ limit: String(INVENTORY_LEDGER_LIMIT) });
  if (opts.movementType) qs.set("movementType", opts.movementType);
  const res = await fetchJson<Envelope<InventoryLedgerRow>, InventoryLedgerRow[]>(
    `/api/v1/inventory/ledger?${qs.toString()}`,
    [],
    {
      revalidateSeconds: 60,
      telemetryKey: "inventory.ledger",
      mapResponse: listOf,
    },
  );
  return withNames(res, async (rows) => {
    const [items, stores] = await Promise.all([getItemNames(rows.map((r) => r.itemId)), getStoreNames()]);
    return rows.map((r) => ({
      ...r,
      itemName: items.get(r.itemId)?.name ?? null,
      itemSku: items.get(r.itemId)?.sku ?? null,
      storeName: stores.get(r.storeId) ?? null,
    }));
  });
}

/** Stores for a picker (id + name), via GET /inventory/stores. */
export function getInventoryStoreOptions(): Promise<LoaderResult<Array<{ id: string; name: string }>>> {
  return fetchJson<unknown, Array<{ id: string; name: string }>>("/api/v1/inventory/stores?limit=200", [], {
    revalidateSeconds: 30,
    telemetryKey: "inventory.storeOptions",
    mapResponse: (payload) => {
      if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
      const out: Array<{ id: string; name: string }> = [];
      for (const r of payload.data) {
        if (isRecord(r) && typeof r.id === "string" && typeof r.name === "string") out.push({ id: r.id, name: r.name });
      }
      return out;
    },
  });
}

/** Categories / units for a picker; failure leaves the list empty (the field is optional). */
export function getInventoryNamedList(
  kind: "categories" | "uoms",
): Promise<LoaderResult<Array<{ id: string; name: string }>>> {
  return fetchJson<unknown, Array<{ id: string; name: string }>>(`/api/v1/inventory/${kind}?limit=200`, [], {
    revalidateSeconds: 60,
    telemetryKey: `inventory.${kind}`,
    mapResponse: (payload) => {
      if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
      const out: Array<{ id: string; name: string }> = [];
      for (const r of payload.data) {
        if (isRecord(r) && typeof r.id === "string" && typeof r.name === "string") out.push({ id: r.id, name: r.name });
      }
      return out;
    },
  });
}

export function getInventoryLowStock(): Promise<LoaderResult<InventoryLowStockRow[]>> {
  return fetchJson<Envelope<InventoryLowStockRow>, InventoryLowStockRow[]>("/api/v1/inventory/low-stock", [], {
    revalidateSeconds: 30,
    telemetryKey: "inventory.lowStock",
    mapResponse: listOf,
  });
}

export async function getInventoryBins(): Promise<LoaderResult<InventoryBinRow[]>> {
  const res = await fetchJson<Envelope<InventoryBinRow>, InventoryBinRow[]>(
    `/api/v1/inventory/bins?limit=${INVENTORY_LIST_LIMIT}`,
    [],
    {
      revalidateSeconds: 60,
      telemetryKey: "inventory.bins",
      mapResponse: listOf,
    },
  );
  return withNames(res, async (rows) => {
    const stores = await getStoreNames();
    return rows.map((r) => ({ ...r, storeName: stores.get(r.storeId) ?? null }));
  });
}

export function getInventoryReservations(): Promise<LoaderResult<InventoryReservationRow[]>> {
  return fetchJson<Envelope<InventoryReservationRow>, InventoryReservationRow[]>(
    "/api/v1/inventory/reservations?limit=200",
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "inventory.reservations",
      mapResponse: listOf,
    },
  );
}

export async function getInventoryGoodsReturns(
  opts: { names?: boolean } = {},
): Promise<LoaderResult<InventoryGoodsReturnRow[]>> {
  const res = await fetchJson<Envelope<InventoryGoodsReturnRow>, InventoryGoodsReturnRow[]>(
    `/api/v1/inventory/goods-returns?limit=${INVENTORY_LIST_LIMIT}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "inventory.goodsReturns",
      mapResponse: listOf,
    },
  );
  // Callers that only count rows (the hub) skip the name lookups.
  if (opts.names === false) return res;
  return withNames(res, async (rows) => {
    const [items, stores] = await Promise.all([getItemNames(rows.map((r) => r.itemId)), getStoreNames()]);
    return rows.map((r) => ({
      ...r,
      itemName: items.get(r.itemId)?.name ?? null,
      itemSku: items.get(r.itemId)?.sku ?? null,
      storeName: stores.get(r.storeId) ?? null,
    }));
  });
}

export async function getInventoryCycleCounts(
  status?: string,
  opts: { names?: boolean } = {},
): Promise<LoaderResult<InventoryCycleCountRow[]>> {
  const path = status
    ? `/api/v1/inventory/cycle-counts?status=${encodeURIComponent(status)}&limit=${INVENTORY_LIST_LIMIT}`
    : `/api/v1/inventory/cycle-counts?limit=${INVENTORY_LIST_LIMIT}`;
  const res = await fetchJson<Envelope<InventoryCycleCountRow>, InventoryCycleCountRow[]>(path, [], {
    revalidateSeconds: 30,
    telemetryKey: "inventory.cycleCounts",
    mapResponse: listOf,
  });
  if (opts.names === false) return res;
  return withNames(res, async (rows) => {
    const [items, warehouses] = await Promise.all([getItemNames(rows.map((r) => r.itemId)), getWarehouseNames()]);
    return rows.map((r) => ({
      ...r,
      itemName: items.get(r.itemId)?.name ?? null,
      itemSku: items.get(r.itemId)?.sku ?? null,
      warehouseName: warehouses.get(r.warehouseId) ?? null,
    }));
  });
}

const emptyForecast: InventoryForecastResult = {
  available: false,
  itemId: "",
  dailyForecast: [],
  totalDemand: 0,
  confidence: 0,
};

/**
 * 30-day demand forecast for a single item (GET /items/:id/forecast). Used by
 * the hub screen to chart projected demand for the item currently nearest its
 * reorder point.
 */
export function getInventoryItemForecast(itemId: string): Promise<LoaderResult<InventoryForecastResult>> {
  return fetchJson<unknown, InventoryForecastResult>(`/api/v1/inventory/items/${itemId}/forecast?horizon=30`, emptyForecast, {
    revalidateSeconds: 60,
    telemetryKey: "inventory.itemForecast",
    mapResponse: (payload) => {
      if (!isRecord(payload)) return null;
      const dailyForecast = Array.isArray(payload.dailyForecast)
        ? payload.dailyForecast.filter((v): v is number => typeof v === "number")
        : [];
      if (dailyForecast.length === 0) {
        return { available: false, itemId, dailyForecast: [], totalDemand: 0, confidence: 0 };
      }
      return {
        available: true,
        itemId,
        dailyForecast,
        totalDemand: typeof payload.totalDemand === "number" ? payload.totalDemand : 0,
        confidence: typeof payload.confidence === "number" ? payload.confidence : 0,
      };
    },
  });
}

export type InventorySubstitutesResult = LoaderResult<InventorySubstituteRow[]> & {
  /** True when the item master has more items than SUBSTITUTES_ITEM_CAP. */
  truncated: boolean;
  /** Number of per-item requests that failed (rows for those items are missing). */
  failedCount: number;
  /** Items in the item master, whether or not they were all fetched. */
  itemCount: number;
};

/**
 * Substitutes are listed per item (GET /items/:id/substitutes). Aggregate across
 * the current item master so the hub screen has a tenant-wide view.
 */
export async function getInventorySubstitutes(): Promise<InventorySubstitutesResult> {
  const { data: items, source: itemsSource } = await getInventoryItems();
  if (itemsSource === "error") {
    return { data: [], source: "error", truncated: false, failedCount: 0, itemCount: 0 };
  }
  if (items.length === 0) {
    return { data: [], source: "api", truncated: false, failedCount: 0, itemCount: 0 };
  }

  const results = await Promise.all(
    items.slice(0, SUBSTITUTES_ITEM_CAP).map((item) =>
      fetchJson<Envelope<InventorySubstituteRow>, InventorySubstituteRow[]>(
        `/api/v1/inventory/items/${item.id}/substitutes`,
        [],
        {
          revalidateSeconds: 60,
          telemetryKey: "inventory.substitutes",
          mapResponse: listOf,
        },
      ),
    ),
  );

  const rows = results.flatMap((r) => r.data);
  const failedCount = results.filter((r) => r.source === "error").length;
  // GAP-INVENTORY-SUBSTITUTES-02: "error" only when EVERY request failed; a
  // partial failure or the item cap is reported via failedCount/truncated so
  // the page can warn instead of showing an incomplete list as complete.
  return {
    data: rows,
    source: failedCount === results.length ? "error" : "api",
    truncated: items.length > SUBSTITUTES_ITEM_CAP,
    failedCount,
    itemCount: items.length,
  };
}
