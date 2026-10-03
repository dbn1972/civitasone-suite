/**
 * inventory route-group server loaders. These call the inventory-service
 * endpoints through the gateway (/api/v1/inventory/*) using the shared,
 * cookie-aware fetchJson helper. They run on the server only.
 *
 * Kept inside the inventory route group (rather than the global _data/loaders)
 * so the module stays self-contained.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { SUBSTITUTES_PAGE_LIMIT } from "./substitutesCoverage";
import { getItemNames, getStoreNames, getSupplierNames, getWarehouseNames } from "./_lookups";

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
  /** Document reference copied from the movement header (GAP-INVENTORY-RECEIPTS-03). */
  refDoc?: string | null;
  refNo?: string | null;
  grnNo?: string | null;
  poRef?: string | null;
  supplierId?: string | null;
  /** Resolved from the procurement vendor list; null when it could not be named. */
  supplierName?: string | null;
} & WithItemName & { storeName?: string | null };

export type InventoryLowStockRow = {
  itemId: string;
  storeId: string;
  name: string;
  sku: string | null;
  onHandQty: number;
  reorderLevel: number;
  suggestedReorderQty: number;
  /** Resolved server-side from the store list (GAP-INVENTORY-LOW-STOCK-03). */
  storeName?: string | null;
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
} & WithItemName & { storeName?: string | null };

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
  /** Names resolved from the item master the loader already fetched (GAP-INVENTORY-SUBSTITUTES-03). */
  itemName?: string | null;
  itemSku?: string | null;
  substituteName?: string | null;
  substituteSku?: string | null;
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
    // Supplier names only matter when a row carries a supplier id (receipts posted from a GRN).
    const needSuppliers = rows.some((r) => r.supplierId);
    const [items, stores, suppliers] = await Promise.all([
      getItemNames(rows.map((r) => r.itemId)),
      getStoreNames(),
      needSuppliers ? getSupplierNames() : Promise.resolve(new Map<string, string>()),
    ]);
    return rows.map((r) => ({
      ...r,
      itemName: items.get(r.itemId)?.name ?? null,
      itemSku: items.get(r.itemId)?.sku ?? null,
      storeName: stores.get(r.storeId) ?? null,
      supplierName: r.supplierId ? suppliers.get(r.supplierId) ?? null : null,
    }));
  });
}

export type InventoryMovementLine = {
  id: string;
  itemId: string;
  qty: number;
  rateMinor: string;
  amountMinor: string;
  itemName?: string | null;
  itemSku?: string | null;
};

export type InventoryMovementDetail = {
  id: string;
  movementType: string;
  postingDate: string;
  refDoc: string | null;
  refNo: string | null;
  grnNo: string | null;
  poRef: string | null;
  reasonCode: string | null;
  notes: string | null;
  status: string;
  fromStoreId: string | null;
  toStoreId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  lines: InventoryMovementLine[];
  fromStoreName?: string | null;
  toStoreName?: string | null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function mapMovementDetail(payload: unknown): InventoryMovementDetail | null {
  const d = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const id = d ? text(d.id) : null;
  if (!d || !id) return null;
  const lines = Array.isArray(d.lines) ? d.lines.filter(isRecord) : [];
  return {
    id,
    movementType: text(d.movementType) ?? "—",
    postingDate: text(d.postingDate) ?? "—",
    refDoc: text(d.refDoc),
    refNo: text(d.refNo),
    grnNo: text(d.grnNo),
    poRef: text(d.poRef),
    reasonCode: text(d.reasonCode),
    notes: text(d.notes),
    status: text(d.status) ?? "posted",
    fromStoreId: text(d.fromStoreId),
    toStoreId: text(d.toStoreId),
    createdBy: text(d.createdBy),
    createdByName: text(d.createdByName),
    createdAt: text(d.createdAt) ?? "—",
    lines: lines.flatMap((l) => {
      const itemId = text(l.itemId);
      const lid = text(l.id);
      if (!itemId || !lid) return [];
      return [{
        id: lid,
        itemId,
        qty: typeof l.qty === "number" ? l.qty : Number(l.qty ?? 0),
        rateMinor: text(l.rateMinor) ?? "0",
        amountMinor: text(l.amountMinor) ?? "0",
      }];
    }),
  };
}

/**
 * One stock movement (receipt / issue / transfer / adjustment) with its lines, via
 * GET /inventory/movements/:id. Target of the "View stock adjustment" link on an
 * approved cycle count (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-05).
 */
export async function getInventoryMovementById(id: string): Promise<LoaderResult<InventoryMovementDetail | null>> {
  const res = await fetchJson<unknown, InventoryMovementDetail | null>(
    `/api/v1/inventory/movements/${encodeURIComponent(id)}`,
    null,
    { revalidateSeconds: 15, telemetryKey: "inventory.movement.detail", mapResponse: mapMovementDetail },
  );
  if (res.source === "error" || !res.data) return res;
  try {
    const m = res.data;
    const [items, stores] = await Promise.all([getItemNames(m.lines.map((l) => l.itemId)), getStoreNames()]);
    return {
      ...res,
      data: {
        ...m,
        fromStoreName: m.fromStoreId ? stores.get(m.fromStoreId) ?? null : null,
        toStoreName: m.toStoreId ? stores.get(m.toStoreId) ?? null : null,
        lines: m.lines.map((l) => ({ ...l, itemName: items.get(l.itemId)?.name ?? null, itemSku: items.get(l.itemId)?.sku ?? null })),
      },
    };
  } catch {
    return res;
  }
}

export type InventorySettings = { qcMakerChecker: boolean };

/**
 * Per-tenant inventory policy (GAP-INVENTORY-GOODS-RETURNS-DETAIL-04). The
 * default when the service cannot be read is the conservative one: maker-checker ON.
 */
export function getInventorySettings(): Promise<LoaderResult<InventorySettings>> {
  return fetchJson<unknown, InventorySettings>("/api/v1/inventory/settings", { qcMakerChecker: true }, {
    revalidateSeconds: 15,
    telemetryKey: "inventory.settings",
    mapResponse: (payload) => {
      const d = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      return d && typeof d.qcMakerChecker === "boolean" ? { qcMakerChecker: d.qcMakerChecker } : null;
    },
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

export async function getInventoryLowStock(): Promise<LoaderResult<InventoryLowStockRow[]>> {
  const res = await fetchJson<Envelope<InventoryLowStockRow>, InventoryLowStockRow[]>("/api/v1/inventory/low-stock", [], {
    revalidateSeconds: 30,
    telemetryKey: "inventory.lowStock",
    mapResponse: listOf,
  });
  return withNames(res, async (rows) => {
    const stores = await getStoreNames();
    return rows.map((r) => ({ ...r, storeName: stores.get(r.storeId) ?? null }));
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

export async function getInventoryReservations(): Promise<LoaderResult<InventoryReservationRow[]>> {
  const res = await fetchJson<Envelope<InventoryReservationRow>, InventoryReservationRow[]>(
    "/api/v1/inventory/reservations?limit=200",
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "inventory.reservations",
      mapResponse: listOf,
    },
  );
  // GAP-INVENTORY-RESERVATIONS-03: item and store names, best-effort.
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
  /** True when the substitutes page is full (SUBSTITUTES_PAGE_LIMIT), so more links may exist. */
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
  // GAP-INVENTORY-SUBSTITUTES-04: one tenant-wide, ordered, paged read instead of
  // one request per item (GET /substitutes, limit capped at SUBSTITUTES_PAGE_LIMIT).
  const [subs, itemsRes] = await Promise.all([
    fetchJson<Envelope<InventorySubstituteRow>, InventorySubstituteRow[]>(
      `/api/v1/inventory/substitutes?limit=${SUBSTITUTES_PAGE_LIMIT}`,
      [],
      { revalidateSeconds: 60, telemetryKey: "inventory.substitutes", mapResponse: listOf },
    ),
    getInventoryItems(),
  ]);
  if (subs.source === "error") {
    return { data: [], source: "error", truncated: false, failedCount: 0, itemCount: 0 };
  }

  // GAP-INVENTORY-SUBSTITUTES-03: name both ends from the item master already
  // in hand. A substitute outside the fetched page keeps a null name (the UI
  // falls back to a short id).
  const items = itemsRes.source === "error" ? [] : itemsRes.data;
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const rows = subs.data.map((r) => ({
    ...r,
    itemName: byId.get(r.itemId)?.name ?? null,
    itemSku: byId.get(r.itemId)?.sku ?? null,
    substituteName: byId.get(r.substituteId)?.name ?? null,
    substituteSku: byId.get(r.substituteId)?.sku ?? null,
  }));
  return {
    data: rows,
    source: "api",
    // A full page means more pairs may exist than were fetched (the page warns instead of showing it as complete).
    truncated: subs.data.length >= SUBSTITUTES_PAGE_LIMIT,
    failedCount: 0,
    itemCount: items.length,
  };
}
