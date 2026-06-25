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

type Envelope<T> = { data?: T[] } | null | undefined;

function listOf<T>(payload: Envelope<T>): T[] {
  return Array.isArray(payload?.data) ? (payload!.data as T[]) : [];
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
