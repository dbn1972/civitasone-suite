/**
 * movements query handlers (READ PATH) — read-through cache, tenant-scoped.
 * Money (paise) is serialised to strings so JSON stays lossless.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { suggestedReorderQty } from "./domain.js";

export type BalanceView = {
  itemId: string; storeId: string; onHandQty: number;
  avgRateMinor: string; valueMinor: string; currency: string;
};

export async function listBalances(
  tenantId: string, opts: { itemId?: string; storeId?: string; limit: number; offset: number },
): Promise<{ data: BalanceView[] }> {
  const hash = `list:${opts.itemId ?? ""}:${opts.storeId ?? ""}:${opts.limit}:${opts.offset}`;
  return cache.listOrLoad(tenantId, RESOURCE.balance, hash, async () => {
    const rows = await repo.listBalances(tenantId, opts);
    return {
      data: rows.map((r) => ({
        itemId: r.itemId, storeId: r.storeId, onHandQty: r.onHandQty,
        avgRateMinor: r.avgRateMinor.toString(),
        valueMinor: (BigInt(r.onHandQty) * r.avgRateMinor).toString(),
        currency: r.currency,
      })),
    };
  });
}

export async function listLedger(
  tenantId: string, opts: { itemId?: string; storeId?: string; from?: string; to?: string; limit: number; offset: number },
): Promise<{ data: Array<Record<string, unknown>> }> {
  const hash = `list:${opts.itemId ?? ""}:${opts.storeId ?? ""}:${opts.from ?? ""}:${opts.to ?? ""}:${opts.limit}:${opts.offset}`;
  return cache.listOrLoad(tenantId, RESOURCE.ledger, hash, async () => {
    const rows = await repo.listLedger(tenantId, opts);
    return {
      data: rows.map((r) => ({
        ...r,
        rateMinor: r.rateMinor.toString(),
        valueMinor: r.valueMinor.toString(),
      })),
    };
  });
}

export type LowStockView = {
  itemId: string; storeId: string; name: string; sku: string | null;
  onHandQty: number; reorderLevel: number; suggestedReorderQty: number;
};

export async function listLowStock(tenantId: string, limit: number, offset: number): Promise<{ data: LowStockView[] }> {
  const hash = `list:${limit}:${offset}`;
  return cache.listOrLoad(tenantId, RESOURCE.lowStock, hash, async () => {
    const rows = await repo.listLowStock(tenantId, limit, offset);
    return {
      data: rows.map((r) => ({
        itemId: r.itemId, storeId: r.storeId, name: r.name, sku: r.sku,
        onHandQty: r.onHandQty, reorderLevel: r.reorderLevel,
        suggestedReorderQty: suggestedReorderQty(r.onHandQty, r.reorderLevel, r.reorderQty),
      })),
    };
  });
}
