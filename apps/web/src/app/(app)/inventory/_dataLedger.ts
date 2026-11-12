/**
 * Loaders for tenants that keep their stock ledger in inventory-service (inventory settings
 * `ledgerSource`, migration 0027). Kept apart from _data.ts so the stock-service-backed registers and
 * their tests are untouched. Server only.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { InventoryItemRow } from "./_data";

export type LedgerSource = "stock" | "inventory";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** "inventory" only when the service says so; an older service without the field means "stock". */
export function mapLedgerSource(payload: unknown): LedgerSource | null {
  const d = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  if (!d) return null;
  return d.ledgerSource === "inventory" ? "inventory" : "stock";
}

/**
 * Which ledger the stock screens use for this tenant. Any failure reads as "stock": today's
 * behaviour is never changed by an unreadable setting.
 */
export function getInventoryLedgerSource(): Promise<LoaderResult<LedgerSource>> {
  return fetchJson<unknown, LedgerSource>("/api/v1/inventory/settings", "stock", {
    revalidateSeconds: 15,
    telemetryKey: "inventory.ledgerSource",
    mapResponse: mapLedgerSource,
  });
}

export type InventoryBalanceRow = { itemId: string; storeId: string; onHandQty: number; valueMinor: string };

const BALANCE_PAGE = 500;
const ITEM_PAGE = 200;
const MAX_PAGES = 20;

function mapBalances(payload: unknown): InventoryBalanceRow[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  const out: InventoryBalanceRow[] = [];
  for (const r of payload.data) {
    if (!isRecord(r) || typeof r.itemId !== "string" || typeof r.storeId !== "string") continue;
    out.push({
      itemId: r.itemId,
      storeId: r.storeId,
      onHandQty: typeof r.onHandQty === "number" ? r.onHandQty : 0,
      valueMinor: typeof r.valueMinor === "string" ? r.valueMinor : "0",
    });
  }
  return out;
}

/** Every balance row of the tenant (paged). A failed page fails the whole read: a half list would understate stock. */
export async function getInventoryBalances(): Promise<LoaderResult<InventoryBalanceRow[]>> {
  const all: InventoryBalanceRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await fetchJson<unknown, InventoryBalanceRow[]>(
      `/api/v1/inventory/balances?limit=${BALANCE_PAGE}&offset=${page * BALANCE_PAGE}`,
      [],
      { revalidateSeconds: 15, telemetryKey: "inventory.balances", mapResponse: mapBalances },
    );
    if (res.source === "error") return { ...res, data: [] };
    all.push(...res.data);
    if (res.data.length < BALANCE_PAGE) break;
  }
  return { data: all, source: "api" };
}

/** Balances of one item across stores (a single page: an item is held in a handful of stores). */
export async function getInventoryItemBalances(itemId: string): Promise<LoaderResult<InventoryBalanceRow[]>> {
  return fetchJson<unknown, InventoryBalanceRow[]>(
    `/api/v1/inventory/balances?itemId=${encodeURIComponent(itemId)}&limit=${BALANCE_PAGE}`,
    [],
    { revalidateSeconds: 15, telemetryKey: "inventory.itemBalances", mapResponse: mapBalances },
  );
}

/** Every item of the item master (paged by the service's 200 cap). */
export async function getAllInventoryItems(): Promise<LoaderResult<InventoryItemRow[]>> {
  const all: InventoryItemRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await fetchJson<unknown, InventoryItemRow[]>(
      `/api/v1/inventory/items?limit=${ITEM_PAGE}&offset=${page * ITEM_PAGE}`,
      [],
      {
        revalidateSeconds: 30,
        telemetryKey: "inventory.itemsAll",
        mapResponse: (payload) => (isRecord(payload) && Array.isArray(payload.data) ? (payload.data as InventoryItemRow[]) : null),
      },
    );
    if (res.source === "error") return { ...res, data: [] };
    all.push(...res.data);
    if (res.data.length < ITEM_PAGE) break;
  }
  return { data: all, source: "api" };
}

/** A row of the Stock Items register, as the register component expects it. */
export type StockRegisterRow = {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number | null;
  minStockLevel: number;
  totalValue: number | null;
  isLowStock: boolean | null;
  stockStatus: "out" | "low" | "ok" | "unknown";
};

/** Item master rows plus their balances summed over every store, in the register's row shape. */
export function registerRowsFromInventory(items: InventoryItemRow[], balances: InventoryBalanceRow[]): StockRegisterRow[] {
  const totals = new Map<string, { qty: number; value: bigint }>();
  for (const b of balances) {
    const t = totals.get(b.itemId) ?? { qty: 0, value: 0n };
    t.qty += b.onHandQty;
    try { t.value += BigInt(b.valueMinor); } catch { /* an unparseable value stays out of the total */ }
    totals.set(b.itemId, t);
  }
  return items.map((i) => {
    const t = totals.get(i.id);
    const qty = t?.qty ?? 0;
    const min = typeof i.reorderLevel === "number" ? i.reorderLevel : 0;
    return {
      id: i.id,
      itemCode: i.sku && i.sku.trim() !== "" ? i.sku : "—",
      name: i.name,
      category: i.category && i.category.trim() !== "" ? i.category : "—",
      unit: i.uom && i.uom.trim() !== "" ? i.uom : "—",
      currentStock: qty,
      minStockLevel: min,
      totalValue: Number(t?.value ?? 0n),
      isLowStock: min > 0 && qty <= min,
      stockStatus: qty <= 0 ? "out" : min > 0 && qty <= min ? "low" : "ok",
    };
  });
}
