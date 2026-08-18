/**
 * inventory route-group server loaders. These call the inventory-service
 * endpoints through the gateway (/api/v1/inventory/*) using the shared,
 * cookie-aware fetchJson helper. They run on the server only.
 *
 * Kept inside the inventory route group (rather than the global _data/loaders)
 * so the module stays self-contained.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

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
};

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
};

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
};

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

export function getInventoryItems(): Promise<LoaderResult<InventoryItemRow[]>> {
  return fetchJson<Envelope<InventoryItemRow>, InventoryItemRow[]>("/api/v1/inventory/items", [], {
    revalidateSeconds: 60,
    telemetryKey: "inventory.items",
    mapResponse: listOf,
  });
}

export function getInventoryLedger(): Promise<LoaderResult<InventoryLedgerRow[]>> {
  return fetchJson<Envelope<InventoryLedgerRow>, InventoryLedgerRow[]>("/api/v1/inventory/ledger?limit=200", [], {
    revalidateSeconds: 60,
    telemetryKey: "inventory.ledger",
    mapResponse: listOf,
  });
}

export function getInventoryLowStock(): Promise<LoaderResult<InventoryLowStockRow[]>> {
  return fetchJson<Envelope<InventoryLowStockRow>, InventoryLowStockRow[]>("/api/v1/inventory/low-stock", [], {
    revalidateSeconds: 30,
    telemetryKey: "inventory.lowStock",
    mapResponse: listOf,
  });
}

export function getInventoryBins(): Promise<LoaderResult<InventoryBinRow[]>> {
  return fetchJson<Envelope<InventoryBinRow>, InventoryBinRow[]>("/api/v1/inventory/bins?limit=200", [], {
    revalidateSeconds: 60,
    telemetryKey: "inventory.bins",
    mapResponse: listOf,
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

export function getInventoryGoodsReturns(): Promise<LoaderResult<InventoryGoodsReturnRow[]>> {
  return fetchJson<Envelope<InventoryGoodsReturnRow>, InventoryGoodsReturnRow[]>(
    "/api/v1/inventory/goods-returns?limit=200",
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "inventory.goodsReturns",
      mapResponse: listOf,
    },
  );
}

export function getInventoryCycleCounts(status?: string): Promise<LoaderResult<InventoryCycleCountRow[]>> {
  const path = status
    ? `/api/v1/inventory/cycle-counts?status=${encodeURIComponent(status)}&limit=200`
    : "/api/v1/inventory/cycle-counts?limit=200";
  return fetchJson<Envelope<InventoryCycleCountRow>, InventoryCycleCountRow[]>(path, [], {
    revalidateSeconds: 30,
    telemetryKey: "inventory.cycleCounts",
    mapResponse: listOf,
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

/**
 * Substitutes are listed per item (GET /items/:id/substitutes). Aggregate across
 * the current item master so the hub screen has a tenant-wide view.
 */
export async function getInventorySubstitutes(): Promise<LoaderResult<InventorySubstituteRow[]>> {
  const { data: items, source: itemsSource } = await getInventoryItems();
  if (itemsSource === "error") {
    return { data: [], source: "error" };
  }
  if (items.length === 0) {
    return { data: [], source: "api" };
  }

  const results = await Promise.all(
    items.slice(0, 50).map((item) =>
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
  const anyApi = results.some((r) => r.source === "api");
  return { data: rows, source: anyApi ? "api" : "error" };
}
